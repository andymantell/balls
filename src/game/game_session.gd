class_name GameSession
extends Node3D
## Plays one or more levels: drives the fixed-rate simulation, input, replays,
## best times and the in-game menus.

signal exited

enum State { PLAYING, PAUSED, LOST, FINISHING, NAME_ENTRY, LEVEL_MENU, REPLAYING, GAME_COMPLETE }

const FINISH_DELAY := 3.5
const MAX_FRAME_TIME := 0.25
const CAMERA_FOV := 74.0  ## the original used a 90 degree horizontal FOV at 4:3
const END_SCREEN := "res://assets/textures/yrgsb.png"

var map_ids: Array[String] = []
var map_index := 0
var campaign := false
## When set, the session only plays back this replay (TOP SCORES).
var viewer_replay: ReplayFile

var world: BallWorld
var view: LevelView
var camera: Camera3D
var hud: Hud
var state := State.PLAYING

var _menu: MenuList
var _menu_panel: Control
var _menu_actions: Array[Callable] = []
var _name_label: Label
var _initials := ""
var _recording := ReplayFile.new()
var _last_run: ReplayFile
var _playback: ReplayFile
var _playback_index := 0
var _accumulator := 0.0
var _finish_timer := 0.0
var _result_ms := 0
var _new_record := false
var _end_screen: TextureRect
var _message_timer := 0.0


func configure(ids: Array[String], index: int, is_campaign: bool, replay: ReplayFile = null) -> GameSession:
	map_ids = ids
	map_index = index
	campaign = is_campaign
	viewer_replay = replay
	return self


func _ready() -> void:
	camera = Camera3D.new()
	camera.fov = CAMERA_FOV
	camera.near = 1.0
	camera.far = Settings.view_distance
	add_child(camera)
	hud = Hud.new()
	add_child(hud)
	_build_overlay()
	Sound.play_music("game")
	_load_level()


func current_map() -> Records.MapInfo:
	return Records.find(map_ids[map_index])


func _load_level() -> void:
	if view:
		view.queue_free()
		view = null
	var info := current_map()
	var file := ThreeDoFile.load_file(info.path)
	if file == null:
		push_error("Cannot load level %s" % info.path)
		exited.emit()
		return
	var textures := TextureLibrary.new()
	textures.extra_dirs = [info.path.get_base_dir()]
	world = BallWorld.from_file(file)
	world.classic_acceleration = Settings.classic_acceleration
	world.sound_requested.connect(Sound.play)
	world.level_completed.connect(_on_level_completed)
	world.ball_lost.connect(_on_ball_lost)
	view = LevelView.new()
	add_child(view)
	view.setup(file, world, textures)
	hud.set_best(Records.best(info.id))
	if viewer_replay:
		_start_replay(viewer_replay)
	else:
		_start_play()


func _start_play() -> void:
	world.reset()
	_recording = ReplayFile.new()
	_accumulator = 0.0
	state = State.PLAYING
	_hide_menu()
	hud.set_play_info_visible(true)
	_flash_message(current_map().title, "LEVEL %d" % (map_index + 1) if campaign else "")
	hud.fade(1.0, 0.0)
	hud.fade(0.0, 0.6)
	Sound.play(&"start")


func _start_replay(replay: ReplayFile) -> void:
	world.reset()
	_playback = replay
	_playback_index = 0
	_accumulator = 0.0
	state = State.REPLAYING
	_hide_menu()
	hud.set_play_info_visible(true)
	_flash_message("REPLAY", current_map().title)
	hud.fade(1.0, 0.0)
	hud.fade(0.0, 0.6)


func _process(delta: float) -> void:
	if _message_timer > 0.0:
		_message_timer -= delta
		if _message_timer <= 0.0 and state in [State.PLAYING, State.REPLAYING]:
			hud.show_message("")
	match state:
		State.PLAYING, State.LOST, State.FINISHING, State.REPLAYING:
			_run_simulation(delta)
		_:
			pass
	if state == State.FINISHING:
		_finish_timer -= delta
		if _finish_timer <= 0.0:
			_after_finish()
	var alpha := clampf(_accumulator / BallWorld.TICK_SECONDS, 0.0, 1.0)
	if view:
		view.update_view(alpha, camera, delta if state != State.PAUSED else 0.0)
		camera.global_transform = view.camera_transform(alpha)
	if world:
		hud.set_time(_result_ms if state in [State.FINISHING, State.NAME_ENTRY, State.LEVEL_MENU] else world.elapsed_msec)
		hud.set_diamonds(world.diamonds_left())
	hud.set_fps(Engine.get_frames_per_second(), Settings.show_fps)


func _run_simulation(delta: float) -> void:
	_accumulator += minf(delta, MAX_FRAME_TIME)
	while _accumulator >= BallWorld.TICK_SECONDS:
		_accumulator -= BallWorld.TICK_SECONDS
		_tick()


func _tick() -> void:
	var input := BallWorld.InputState.new()
	if state == State.REPLAYING:
		if _playback_index >= _playback.size():
			_on_replay_finished()
			return
		input.action = _playback.actions[_playback_index] != 0
		world.step(input)
		world.override_ball(_playback.positions[_playback_index], _playback.velocities[_playback_index])
		_playback_index += 1
		return
	if state == State.PLAYING:
		input.up = Input.is_action_pressed(&"ball_up")
		input.down = Input.is_action_pressed(&"ball_down")
		input.left = Input.is_action_pressed(&"ball_left")
		input.right = Input.is_action_pressed(&"ball_right")
		input.action = Input.is_action_pressed(&"ball_action")
	world.step(input)
	if state != State.LOST:
		_recording.append(world.position, world.velocity, input.action)


func _unhandled_input(event: InputEvent) -> void:
	if state == State.NAME_ENTRY:
		_name_entry_input(event)
		return
	if state == State.GAME_COMPLETE:
		if event.is_pressed() and not event.is_echo() and (event is InputEventKey or event is InputEventJoypadButton):
			get_viewport().set_input_as_handled()
			exited.emit()
		return
	if state in [State.PLAYING, State.REPLAYING]:
		if event.is_action_pressed(&"pause_menu"):
			get_viewport().set_input_as_handled()
			if state == State.REPLAYING and viewer_replay:
				exited.emit()
			elif state == State.REPLAYING:
				_show_level_menu()
			else:
				_pause()
		elif event.is_action_pressed(&"restart_level") and state == State.PLAYING:
			get_viewport().set_input_as_handled()
			_start_play()
		elif event.is_action_pressed(&"toggle_camera"):
			get_viewport().set_input_as_handled()
			world.camera_mode = 1 - world.camera_mode


# --- Level events ------------------------------------------------------------

func _on_level_completed() -> void:
	if state == State.REPLAYING:
		_flash_message("COMPLETED", Records.format_time(world.elapsed_msec))
		return
	_result_ms = world.elapsed_msec
	_new_record = Records.is_record(current_map().id, _result_ms)
	Sound.play(&"endbest" if _new_record else &"end")
	hud.show_message("COMPLETED", ("NEW BEST TIME %s" if _new_record else "TIME %s") % Records.format_time(_result_ms))
	state = State.FINISHING
	_finish_timer = FINISH_DELAY


func _after_finish() -> void:
	_last_run = _recording
	if _new_record:
		state = State.NAME_ENTRY
		_initials = ""
		_show_name_entry()
	else:
		_show_level_menu()


func _on_ball_lost() -> void:
	if state != State.PLAYING:
		return
	state = State.LOST
	var t := hud.fade(1.0, 0.6)
	t.finished.connect(func():
		if state == State.LOST:
			_start_play())


func _on_replay_finished() -> void:
	if viewer_replay:
		exited.emit()
		return
	_show_level_menu()


# --- Menus -------------------------------------------------------------------

func _build_overlay() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 10
	add_child(layer)
	_menu_panel = Control.new()
	_menu_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	_menu_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(_menu_panel)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0.05, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	_menu_panel.add_child(dim)
	_menu = MenuList.new()
	_menu.set_anchors_preset(Control.PRESET_FULL_RECT)
	_menu.activated.connect(func(i): _menu_actions[i].call())
	_menu.cancelled.connect(_on_menu_cancel)
	_menu_panel.add_child(_menu)
	_name_label = Label.new()
	_name_label.set_anchors_preset(Control.PRESET_FULL_RECT)
	_name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_name_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_name_label.add_theme_font_override("font", BitmapFont.get_font())
	_name_label.add_theme_font_size_override("font_size", 56)
	_name_label.modulate = MenuList.COLOR_SELECTED
	_menu_panel.add_child(_name_label)
	_end_screen = TextureRect.new()
	_end_screen.texture = load(END_SCREEN)
	_end_screen.set_anchors_preset(Control.PRESET_FULL_RECT)
	_end_screen.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_end_screen.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_end_screen.visible = false
	layer.add_child(_end_screen)
	_hide_menu()


func _show_menu(title: String, entries: Array) -> void:
	_menu_actions.clear()
	var names: Array[String] = []
	for e in entries:
		names.append(e[0])
		_menu_actions.append(e[1])
	_menu.title = title
	_menu.selected = 0
	_menu.set_items(names)
	_menu.visible = true
	_menu.active = true
	_name_label.visible = false
	_menu_panel.visible = true


func _hide_menu() -> void:
	_menu_panel.visible = false
	_menu.active = false


func _pause() -> void:
	state = State.PAUSED
	_show_menu("PAUSED", [
		["RETURN TO GAME", _resume],
		["RESTART LEVEL", _start_play],
		["QUIT TO MENU", func(): exited.emit()],
	])


func _resume() -> void:
	_hide_menu()
	state = State.PLAYING


func _on_menu_cancel() -> void:
	if state == State.PAUSED:
		_resume()
	elif state == State.LEVEL_MENU:
		exited.emit()


func _show_level_menu() -> void:
	state = State.LEVEL_MENU
	hud.show_message("")
	var entries := []
	var has_next := campaign and map_index + 1 < map_ids.size()
	if _last_run and world.finished:
		if campaign:
			entries.append(["CONTINUE TO NEXT LEVEL" if has_next else "CONTINUE", _next_level])
	entries.append(["RESTART LEVEL", _start_play])
	if _last_run:
		entries.append(["SHOW REPLAY", func(): _start_replay(_last_run)])
	entries.append(["QUIT TO MENU", func(): exited.emit()])
	var title := "COMPLETED %s" % Records.format_time(_result_ms) if world.finished and _last_run else current_map().title
	_show_menu(title, entries)


func _next_level() -> void:
	if map_index + 1 < map_ids.size():
		map_index += 1
		_last_run = null
		_load_level()
	else:
		_show_game_complete()


func _show_game_complete() -> void:
	state = State.GAME_COMPLETE
	_hide_menu()
	hud.set_play_info_visible(false)
	hud.show_message("")
	_end_screen.visible = true
	Sound.play(&"endbest")


# --- Name entry ----------------------------------------------------------------

func _show_name_entry() -> void:
	_menu_panel.visible = true
	_menu.visible = false
	_menu.active = false
	_name_label.visible = true
	_update_name_label()


func _update_name_label() -> void:
	var shown := _initials + "_".repeat(3 - _initials.length())
	_name_label.text = "NEW BEST TIME %s\nENTER YOUR NAME:\n%s" % [Records.format_time(_result_ms), shown]


func _name_entry_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed:
		return
	get_viewport().set_input_as_handled()
	var key := event as InputEventKey
	if key.keycode == KEY_ENTER or key.keycode == KEY_KP_ENTER:
		if _initials.is_empty():
			_initials = "???"
		Records.submit(current_map().id, _result_ms, _initials, _last_run)
		hud.set_best(Records.best(current_map().id))
		_show_level_menu()
	elif key.keycode == KEY_BACKSPACE:
		_initials = _initials.left(-1)
	elif _initials.length() < 3 and key.unicode > 0:
		var ch := char(key.unicode).to_upper()
		if ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
			_initials += ch
	_update_name_label()


func _flash_message(text: String, sub := "") -> void:
	hud.show_message(text, sub)
	_message_timer = 2.0
