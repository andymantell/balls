class_name MenuScreen
extends Node3D
## Main menu: the original 3D menu scene (menu.3do) - a chrome ball wearing the
## menu text that rotates 72 degrees per entry, lightning and a waving logo -
## plus the text based sub menus.

signal start_campaign
signal start_map(id: String)
signal watch_replay(id: String)
signal quit_requested

const MODEL := "res://assets/models/menu.3do"
const WAVE_SHADER := preload("res://assets/shaders/logo_wave.gdshader")
const MAIN_ITEMS: Array[String] = ["START GAME", "SINGLE MAP", "TOP SCORES", "SETUP", "QUIT"]
const WHEEL_STEP := TAU / 5.0
const KEY_NAMES := {
	&"ball_up": "UP", &"ball_down": "DOWN", &"ball_left": "LEFT", &"ball_right": "RIGHT",
	&"ball_action": "ACTION", &"restart_level": "RESTART", &"toggle_camera": "CAMERA",
}

enum Page { MAIN, SINGLE_MAP, TOP_SCORES, SETUP, CONTROLS, WAIT_KEY }

static var _remembered := {}  ## page -> selected index ("menus return to the right place")

var page := Page.MAIN
var _wheel: Node3D
var _wheel_angle := 0.0
var _wheel_target := 0.0
var _main_index := 0
var _spinners: Array[Node3D] = []
var _menu: MenuList
var _caption: Label
var _hint: Label
var _waiting_action: StringName
var _map_ids: Array[String] = []
var _time := 0.0


func _ready() -> void:
	Sound.play_music("menu")
	_build_scene()
	_build_ui()
	_main_index = _remembered.get(Page.MAIN, 0)
	_wheel_target = _main_index * WHEEL_STEP
	_wheel_angle = _wheel_target
	_show_main()


func _build_scene() -> void:
	var file := ThreeDoFile.load_file(MODEL)
	var builder := ModelBuilder.new(TextureLibrary.new(), Settings.lighting, Settings.specular)
	var model := builder.build_model(file)
	add_child(model)
	_wheel = Node3D.new()
	add_child(_wheel)
	for child in model.get_children():
		var mi := child as MeshInstance3D
		var special: int = mi.get_meta("special")
		if special == SimObject.Special.GATE_BLUE:
			# SP5: the sphere carrying the menu text.
			model.remove_child(mi)
			_wheel.add_child(mi)
		elif special == SimObject.Special.GATE_GREEN:
			# SP6: the logo plane.
			var mat := ShaderMaterial.new()
			mat.shader = WAVE_SHADER
			mat.set_shader_parameter("logo", load("res://assets/textures/balls.png"))
			mi.material_override = mat
		if mi.get_meta("spin", Vector3.ZERO) != Vector3.ZERO:
			_spinners.append(mi)
	for r in file.points:
		if r.is_light():
			var light := OmniLight3D.new()
			light.position = Coords.from_point(r.position)
			light.light_color = r.color
			light.omni_range = 100000.0
			light.omni_attenuation = 0.0
			add_child(light)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color.BLACK
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.15, 0.12, 0.12)
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var cam := Camera3D.new()
	cam.fov = 74.0
	cam.position = Vector3(0, 0, 250)
	cam.far = 5000.0
	add_child(cam)
	cam.make_current()


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	_menu = MenuList.new()
	_menu.set_anchors_preset(Control.PRESET_FULL_RECT)
	_menu.activated.connect(_on_activated)
	_menu.cancelled.connect(_on_cancelled)
	_menu.adjusted.connect(_on_adjusted)
	layer.add_child(_menu)
	_caption = _label(54, Control.PRESET_CENTER_BOTTOM, -96)
	_hint = _label(26, Control.PRESET_CENTER_BOTTOM, -40)
	_hint.modulate = Color(0.6, 0.7, 0.85)
	layer.add_child(_caption)
	layer.add_child(_hint)


func _label(size: int, preset: Control.LayoutPreset, y: float) -> Label:
	var l := Label.new()
	l.add_theme_font_override("font", BitmapFont.get_font())
	l.add_theme_font_size_override("font_size", size)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.set_anchors_preset(preset)
	l.grow_horizontal = Control.GROW_DIRECTION_BOTH
	l.position.y += y
	l.modulate = MenuList.COLOR_SELECTED
	return l


func _process(delta: float) -> void:
	_time += delta
	_wheel_angle = lerp_angle(_wheel_angle, _wheel_target, 1.0 - exp(-delta * 10.0))
	_wheel.basis = Basis(Vector3.RIGHT, -_wheel_angle)
	for s in _spinners:
		s.basis = Coords.rotation_basis(s.get_meta("spin") * _time / BallWorld.TICK_SECONDS)


func _unhandled_input(event: InputEvent) -> void:
	if page == Page.WAIT_KEY:
		if event is InputEventKey and event.pressed and not event.echo:
			get_viewport().set_input_as_handled()
			if event.keycode != KEY_ESCAPE:
				Settings.set_key(_waiting_action, event.physical_keycode if event.physical_keycode else event.keycode)
			_show_controls()
		return
	if page != Page.MAIN:
		return
	if event.is_action_pressed(&"ui_up") or event.is_action_pressed(&"ball_up"):
		_rotate_wheel(-1)
	elif event.is_action_pressed(&"ui_down") or event.is_action_pressed(&"ball_down"):
		_rotate_wheel(1)
	elif event.is_action_pressed(&"ui_accept") or event.is_action_pressed(&"ball_action"):
		Sound.play(&"dia", 0.5)
		_activate_main(_main_index)
	elif event.is_action_pressed(&"ui_cancel"):
		_main_index = MAIN_ITEMS.size() - 1
		_wheel_target = _main_index * WHEEL_STEP
		_update_caption()
	else:
		return
	get_viewport().set_input_as_handled()


func _rotate_wheel(dir: int) -> void:
	_main_index = (_main_index + dir + MAIN_ITEMS.size()) % MAIN_ITEMS.size()
	_wheel_target += dir * WHEEL_STEP
	Sound.play(&"boun", 0.4)
	_update_caption()


func _update_caption() -> void:
	_caption.text = MAIN_ITEMS[_main_index]
	_remembered[Page.MAIN] = _main_index


func _show_main() -> void:
	page = Page.MAIN
	_menu.visible = false
	_menu.active = false
	_wheel.visible = true
	_caption.visible = true
	_hint.text = "ARROWS: CHOOSE    SPACE: SELECT"
	_update_caption()


func _show_list(new_page: Page, title: String, items: Array, values: Array = []) -> void:
	page = new_page
	_wheel.visible = false
	_caption.visible = false
	_menu.title = title
	_menu.set_items(items, values)
	_menu.select(_remembered.get(new_page, 0))
	_menu.visible = true
	_menu.active = true
	_hint.text = "ESC: BACK"


func _activate_main(i: int) -> void:
	match i:
		0: start_campaign.emit()
		1: _show_single_map()
		2: _show_top_scores()
		3: _show_setup()
		4: quit_requested.emit()


func _show_single_map() -> void:
	_map_ids.clear()
	var names := []
	var times := []
	for m in Records.maps:
		_map_ids.append(m.id)
		names.append(m.title)
		var b := Records.best(m.id)
		times.append(Records.format_time(b["time_ms"]) if not b.is_empty() else "")
	_show_list(Page.SINGLE_MAP, "SINGLE MAP", names, times)


func _show_top_scores() -> void:
	_map_ids.clear()
	var names := []
	var values := []
	for m in Records.maps:
		var b := Records.best(m.id)
		if b.is_empty():
			continue
		_map_ids.append(m.id)
		names.append(m.title)
		values.append("%s %s" % [Records.format_time(b["time_ms"]), b["name"]])
	_show_list(Page.TOP_SCORES, "TOP SCORES", names, values)
	_hint.text = "SPACE: WATCH BEST TIME REPLAY    ESC: BACK"


func _show_setup() -> void:
	var items := ["MUSIC", "SOUND", "FULLSCREEN", "ANTIALIAS", "SPECULAR", "LIGHTING", "LIGHT GLOWS", "CLASSIC STEERING", "SHOW FPS", "CHANGE CONTROLS", "BACK"]
	_show_list(Page.SETUP, "SETUP", items, _setup_values())
	_hint.text = "LEFT/RIGHT: CHANGE    ESC: BACK"


func _setup_values() -> Array:
	return [
		"%d%%" % roundi(Settings.music_volume * 100),
		"%d%%" % roundi(Settings.sfx_volume * 100),
		"ON" if Settings.fullscreen else "OFF",
		"ON" if Settings.msaa else "OFF",
		"ON" if Settings.specular else "OFF",
		"CLASSIC" if Settings.lighting == Settings.Lighting.CLASSIC else "MODERN",
		"ON" if Settings.glows else "OFF",
		"ON" if Settings.classic_acceleration else "OFF",
		"ON" if Settings.show_fps else "OFF",
		"", "",
	]


func _show_controls() -> void:
	var items := []
	var values := []
	for action in Settings.REMAPPABLE_ACTIONS:
		items.append(KEY_NAMES[action])
		values.append(OS.get_keycode_string(Settings.get_key(action)).to_upper())
	items.append("DEFAULT KEYS")
	values.append("")
	items.append("BACK")
	values.append("")
	_show_list(Page.CONTROLS, "CONTROLS", items, values)
	_hint.text = "SPACE: CHANGE KEY    ESC: BACK"


func _on_activated(i: int) -> void:
	_remembered[page] = i
	match page:
		Page.SINGLE_MAP:
			start_map.emit(_map_ids[i])
		Page.TOP_SCORES:
			watch_replay.emit(_map_ids[i])
		Page.SETUP:
			if i == 9:
				_show_controls()
			elif i == 10:
				_show_main()
			else:
				_on_adjusted(i, 1)
		Page.CONTROLS:
			var n := Settings.REMAPPABLE_ACTIONS.size()
			if i < n:
				_waiting_action = Settings.REMAPPABLE_ACTIONS[i]
				page = Page.WAIT_KEY
				_menu.active = false
				_hint.text = "PRESS A KEY FOR %s" % KEY_NAMES[_waiting_action]
			elif i == n:
				Settings.reset_keys()
				_show_controls()
				_menu.select(i)
			else:
				_show_setup()


func _on_adjusted(i: int, dir: int) -> void:
	if page != Page.SETUP:
		return
	match i:
		0: Settings.music_volume = clampf(Settings.music_volume + 0.1 * dir, 0.0, 1.0)
		1: Settings.sfx_volume = clampf(Settings.sfx_volume + 0.1 * dir, 0.0, 1.0)
		2: Settings.fullscreen = not Settings.fullscreen
		3: Settings.msaa = not Settings.msaa
		4: Settings.specular = not Settings.specular
		5: Settings.lighting = 1 - Settings.lighting
		6: Settings.glows = not Settings.glows
		7: Settings.classic_acceleration = not Settings.classic_acceleration
		8: Settings.show_fps = not Settings.show_fps
		_: return
	Settings.apply()
	Settings.save_settings()
	var values := _setup_values()
	for k in values.size():
		_menu.set_value(k, values[k])
	if i == 1:
		Sound.play(&"dia")


func _on_cancelled() -> void:
	match page:
		Page.CONTROLS:
			_show_setup()
		_:
			_show_main()
