class_name LevelView
extends Node3D
## Renders a [BallWorld]: level meshes, lights, diamonds, the ball and effects.
## Simulation runs at 62.5 Hz; [method update_view] interpolates in between.

const BACKGROUND_SHADER := preload("res://assets/shaders/rolling_background.gdshader")
const BALL_MODEL := "res://assets/models/ball.3do"
const BLUE_BALL_MODEL := "res://assets/models/ball2.3do"
const DIAMOND_MODEL := "res://assets/models/dia.3do"
const GLOW_TEXTURE := "res://assets/textures/flare.png"
const SPARK_TEXTURE := "res://assets/textures/flare.png"
const ZAP_TEXTURE := "res://assets/textures/salama.png"
const HUGE_LIGHT_RANGE := 9999
const GLOW_SCALE := 22.0
## D3D6 point lights kept full intensity up to their range; Godot's smooth
## range window fades out earlier, so ranges are stretched to compensate.
const RANGE_STRETCH := 1.6

## Ball "ambient" (glow) colour per ball type, as set by BALLS.EXE.
const BALL_GLOW: Array[Color] = [Color(0, 0, 0), Color(1, 0, 0), Color(1, 1, 0), Color(0, 0, 1), Color(0, 1, 0)]
const BALL_LIGHT: Array[Color] = [Color(0, 0, 0), Color(1, 0.2, 0.2), Color(1, 1, 0.2), Color(0.2, 0.3, 1), Color(0.2, 1, 0.2)]
const BALL_LIGHT_RANGE: Array[float] = [0.0, 300.0, 300.0, 200.0, 250.0]

var world: BallWorld
var builder: ModelBuilder

var _object_nodes: Array[MeshInstance3D] = []
var _light_nodes := {}  ## point index -> Node3D (light + glow)
var _diamond_nodes: Array[Node3D] = []
var _ball_root: Node3D
var _ball_models: Array[Node3D] = []  ## [normal, blue]
var _ball_spheres: Array[MeshInstance3D] = []
var _ball_materials: Array[StandardMaterial3D] = []
var _shadows: Array[MeshInstance3D] = []
var _ball_light: OmniLight3D
var _sparks: CPUParticles3D
var _zap: MeshInstance3D
var _roll := Basis.IDENTITY
var _last_ball_pos := Vector3.ZERO
var _time := 0.0


func setup(file: ThreeDoFile, sim: BallWorld, textures: TextureLibrary) -> void:
	world = sim
	builder = ModelBuilder.new(textures, Settings.lighting, Settings.specular)
	_build_environment(file, textures)
	for i in file.objects.size():
		var mi := MeshInstance3D.new()
		mi.mesh = builder.build_mesh(file.objects[i])
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		_object_nodes.append(mi)
	for i in file.points.size():
		var r := file.points[i]
		if r.type == ThreeDoFile.PointType.LIGHT:
			_light_nodes[i] = _make_light(r)
	_build_diamonds()
	_build_ball()
	_build_effects()
	update_view(1.0)


func _build_environment(file: ThreeDoFile, textures: TextureLibrary) -> void:
	var env := Environment.new()
	var tex := textures.get_texture(file.background)
	if tex:
		var mat := ShaderMaterial.new()
		mat.shader = BACKGROUND_SHADER
		mat.set_shader_parameter("background", tex)
		var sky := Sky.new()
		sky.sky_material = mat
		sky.process_mode = Sky.PROCESS_MODE_AUTOMATIC
		sky.radiance_size = Sky.RADIANCE_SIZE_32
		env.background_mode = Environment.BG_SKY
		env.sky = sky
	else:
		env.background_mode = Environment.BG_COLOR
		env.background_color = Color.BLACK
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.04, 0.04, 0.05)
	env.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)


func _make_light(r: ThreeDoFile.PointRecord) -> Node3D:
	var root := Node3D.new()
	add_child(root)
	var light := OmniLight3D.new()
	light.light_color = r.color
	# D3D lights of this era had constant attenuation up to their range;
	# a range of 10000 meant "reaches everywhere".
	light.omni_range = 1.0e5 if r.light_range > HUGE_LIGHT_RANGE else float(maxi(r.light_range, 1)) * RANGE_STRETCH
	light.omni_attenuation = 0.0
	light.light_specular = 0.6 if Settings.specular else 0.0
	root.add_child(light)
	if Settings.glows and r.glow > 0.0:
		root.add_child(_make_glow(r.color, r.glow * GLOW_SCALE))
	return root


func _make_glow(color: Color, size: float) -> Sprite3D:
	var s := Sprite3D.new()
	s.texture = load(GLOW_TEXTURE)
	s.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	s.shaded = false
	s.modulate = color
	s.pixel_size = size / 256.0
	s.render_priority = 1
	s.no_depth_test = false
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mat.albedo_texture = s.texture
	mat.albedo_color = color
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	s.material_override = mat
	return s


func _build_diamonds() -> void:
	var file := ThreeDoFile.load_file(DIAMOND_MODEL)
	for d in world.diamonds:
		var node := builder.build_model(file)
		add_child(node)
		_diamond_nodes.append(node)


func _build_ball() -> void:
	_ball_root = Node3D.new()
	add_child(_ball_root)
	for path in [BALL_MODEL, BLUE_BALL_MODEL]:
		var file := ThreeDoFile.load_file(path)
		var model := builder.build_model(file)
		_ball_root.add_child(model)
		_ball_models.append(model)
		for child in model.get_children():
			var mi := child as MeshInstance3D
			if mi.get_meta("special") == SimObject.Special.GATE_BLUE:
				# SP5 is the shadow plane; it is projected onto the ground.
				model.remove_child(mi)
				add_child(mi)
				_shadows.append(mi)
			elif mi.get_index() == 0:
				var mat := (mi.mesh.surface_get_material(0) as StandardMaterial3D).duplicate() as StandardMaterial3D
				mat.emission_enabled = true
				mat.emission_texture = mat.albedo_texture
				mat.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
				mi.mesh.surface_set_material(0, mat)
				_ball_spheres.append(mi)
				_ball_materials.append(mat)
	_ball_light = OmniLight3D.new()
	_ball_light.omni_attenuation = 0.5
	_ball_root.add_child(_ball_light)


func _build_effects() -> void:
	_sparks = CPUParticles3D.new()
	_sparks.amount = 160
	_sparks.lifetime = 0.6
	_sparks.local_coords = false
	_sparks.emitting = false
	_sparks.direction = Vector3.UP
	_sparks.spread = 180.0
	_sparks.initial_velocity_min = 10.0
	_sparks.initial_velocity_max = 40.0
	_sparks.gravity = Vector3(0, -60, 0)
	_sparks.scale_amount_min = 0.6
	_sparks.scale_amount_max = 1.2
	var quad := QuadMesh.new()
	quad.size = Vector2(6, 6)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = load(SPARK_TEXTURE)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	quad.material = mat
	_sparks.mesh = quad
	add_child(_sparks)

	_zap = MeshInstance3D.new()
	_zap.mesh = ImmediateMesh.new()
	var zmat := StandardMaterial3D.new()
	zmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	zmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	zmat.albedo_texture = load(ZAP_TEXTURE)
	zmat.cull_mode = BaseMaterial3D.CULL_DISABLED
	zmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_zap.material_override = zmat
	add_child(_zap)


## Interpolates the scene between the last two simulation ticks.
func update_view(alpha: float, camera: Camera3D = null, delta := 0.0) -> void:
	_time += delta
	for i in _object_nodes.size():
		_object_nodes[i].transform = world.objects[i].interpolated_transform(alpha)
	for i in _light_nodes:
		var p := world.points[i]
		_light_nodes[i].position = p.prev_position.lerp(p.position, alpha)
	_update_diamonds(alpha)
	_update_ball(alpha, camera)


func _update_diamonds(alpha: float) -> void:
	for i in _diamond_nodes.size():
		var d := world.diamonds[i]
		var node := _diamond_nodes[i]
		node.visible = d.alive
		if not d.alive:
			continue
		node.position = d.point.prev_position.lerp(d.point.position, alpha)
		var s := 1.0 if d.fade == 0.0 else maxf(d.fade, 0.05)
		node.scale = Vector3(s, 1.0 / s, s) if d.fade > 0.0 else Vector3.ONE
		_spin_children(node, 1.0 + (1.0 - s) * 6.0)


func _spin_children(model: Node3D, speed := 1.0) -> void:
	for child in model.get_children():
		var spin: Vector3 = child.get_meta("spin", Vector3.ZERO)
		if spin != Vector3.ZERO:
			var a := spin * _time / BallWorld.TICK_SECONDS * speed
			child.basis = Coords.rotation_basis(a)


func _update_ball(alpha: float, camera: Camera3D) -> void:
	var pos := world.prev_position.lerp(world.position, alpha)
	var moved := pos - _last_ball_pos
	_last_ball_pos = pos
	if moved.length() > 0.0001 and moved.length() < 100.0:
		var axis := Vector3.UP.cross(moved)
		if axis.length() > 0.0001:
			_roll = Basis(axis.normalized(), moved.length() / BallWorld.BALL_RADIUS) * _roll
			_roll = _roll.orthonormalized()
	_ball_root.position = pos
	var blue := world.ball_type == BallWorld.BallType.BLUE
	for i in _ball_models.size():
		_ball_models[i].visible = (i == 1) == blue
		_shadows[i].visible = (i == 1) == blue
	for s in _ball_spheres:
		s.basis = _roll
	for m in _ball_materials:
		m.emission = BALL_GLOW[world.ball_type]
	_spin_children(_ball_models[1])

	var ground := world.ground_below(pos)
	for s in _shadows:
		if ground.is_empty():
			s.visible = false
			continue
		var n: Vector3 = ground["normal"]
		var height := pos.y - (ground["position"] as Vector3).y
		s.position = (ground["position"] as Vector3) + n * 0.5
		var up := n if n.y > 0.0 else -n
		var x := up.cross(Vector3.BACK).normalized() if absf(up.z) < 0.99 else Vector3.RIGHT
		var scale := clampf(1.3 - height / 400.0, 0.3, 1.3)
		s.basis = Basis(x, up, x.cross(up)).orthonormalized().scaled(Vector3(scale, 1, scale))

	var t := world.ball_type
	var light_range := BALL_LIGHT_RANGE[t]
	if t == BallWorld.BallType.BLUE and world.zap_timer > 0:
		light_range = 2000.0
	_ball_light.visible = light_range > 0.0
	_ball_light.light_color = BALL_LIGHT[t]
	_ball_light.omni_range = maxf(light_range, 1.0)

	var sparking := (t == BallWorld.BallType.RED and world.velocity.length() > 0.5) \
		or (t == BallWorld.BallType.YELLOW and world.jump_timer > 0) \
		or (t == BallWorld.BallType.GREEN and Input.is_action_pressed(&"ball_action") and world.velocity.length() > 0.2)
	_sparks.position = pos
	_sparks.color = BALL_LIGHT[t]
	_sparks.emitting = sparking
	_draw_zap(pos, camera)


func _draw_zap(from: Vector3, camera: Camera3D) -> void:
	var im := _zap.mesh as ImmediateMesh
	im.clear_surfaces()
	if world.zap_timer <= 0 or camera == null:
		return
	var to := world.zap_target
	var dir := to - from
	var view := camera.global_position - from
	var side := dir.cross(view).normalized() * (6.0 + world.zap_timer * 0.4)
	var flicker := float(Time.get_ticks_msec() / 40 % 4) * 0.25
	im.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
	im.surface_set_uv(Vector2(flicker, 0)); im.surface_add_vertex(from - side)
	im.surface_set_uv(Vector2(flicker, 1)); im.surface_add_vertex(from + side)
	im.surface_set_uv(Vector2(flicker + 2, 0)); im.surface_add_vertex(to - side)
	im.surface_set_uv(Vector2(flicker + 2, 1)); im.surface_add_vertex(to + side)
	im.surface_end()


## Camera position/target for this frame.
func camera_transform(alpha: float) -> Transform3D:
	var cam := world.prev_camera_position.lerp(world.camera_position, alpha)
	var target := world.prev_position.lerp(world.position, alpha)
	if cam.is_equal_approx(target):
		cam += Vector3(0, 1, 0)
	return Transform3D(Basis.IDENTITY, cam).looking_at(target, Vector3.UP)
