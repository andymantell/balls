extends Node
## End-to-end smoke test of menus and a full play-through (headless):
##   godot --headless res://tests/smoke_test.tscn
## Exits with code 0 on success.

const TIMEOUT_MSEC := 30000

var _failures := 0
var _started_map := ""


func _ready() -> void:
	_run.call_deferred()


func _run() -> void:
	DirAccess.make_dir_recursive_absolute("user://smoke_test")
	Records.use_storage("user://smoke_test/records.cfg", "user://smoke_test/replays/")
	_check_all_levels_load()
	await _check_menu()
	await _check_session()
	_cleanup()
	print("SMOKE TEST %s (%d failures)" % ["PASSED" if _failures == 0 else "FAILED", _failures])
	get_tree().quit(1 if _failures else 0)


func _expect(cond: bool, what: String) -> void:
	if cond:
		print("  ok   ", what)
	else:
		_failures += 1
		print("  FAIL ", what)


func _frames(n := 1) -> void:
	for i in n:
		await get_tree().process_frame


func _press(action: StringName) -> void:
	var e := InputEventAction.new()
	e.action = action
	e.pressed = true
	Input.parse_input_event(e)
	await _frames(2)
	e = e.duplicate()
	e.pressed = false
	Input.parse_input_event(e)
	await _frames(1)


func _type(keycode: Key, unicode := 0) -> void:
	var e := InputEventKey.new()
	e.keycode = keycode
	e.physical_keycode = keycode
	e.unicode = unicode
	e.pressed = true
	Input.parse_input_event(e)
	await _frames(2)


func _check_all_levels_load() -> void:
	print("levels:")
	for m in Records.maps:
		var file := ThreeDoFile.load_file(m.path)
		var world := BallWorld.from_file(file) if file else null
		_expect(world != null and world.diamonds.size() > 0, "%s loads (%d objects, %d diamonds)" % [m.id, world.objects.size() if world else 0, world.diamonds.size() if world else 0])
	_expect(Records.maps.size() >= 15, "all 15 built-in levels listed")
	for model in ["ball", "ball2", "dia", "menu"]:
		_expect(ThreeDoFile.load_file("res://assets/models/%s.3do" % model) != null, "model %s loads" % model)


func _check_menu() -> void:
	print("menu:")
	var menu := MenuScreen.new()
	add_child(menu)
	menu.start_map.connect(func(id): _started_map = id)
	await _frames(3)
	for i in 3:
		await _press(&"ui_down")
	await _press(&"ui_accept")
	_expect(menu.page == MenuScreen.Page.SETUP, "SETUP opens from the wheel")
	var volume := Settings.music_volume
	await _press(&"ui_left")
	_expect(not is_equal_approx(Settings.music_volume, volume), "music volume adjustable")
	Settings.music_volume = volume
	await _press(&"ui_cancel")
	_expect(menu.page == MenuScreen.Page.MAIN, "ESC returns to the main menu")
	await _press(&"ui_up")
	await _press(&"ui_up")
	await _press(&"ui_accept")
	_expect(menu.page == MenuScreen.Page.SINGLE_MAP, "SINGLE MAP list opens")
	await _press(&"ui_accept")
	_expect(_started_map == Records.CAMPAIGN[0], "selecting a map starts it (%s)" % _started_map)
	menu.queue_free()
	await _frames(2)


func _check_session() -> void:
	print("session:")
	var session := GameSession.new().configure(["bounce"] as Array[String], 0, false)
	var exited := [false]
	session.exited.connect(func(): exited[0] = true)
	add_child(session)
	await _frames(5)
	var start := session.world.position
	Input.action_press(&"ball_up")
	await _frames(30)
	Input.action_release(&"ball_up")
	_expect(session.world.tick > 0 and session.world.position != start, "ball moves with input")

	await _press(&"pause_menu")
	_expect(session.state == GameSession.State.PAUSED, "ESC pauses")
	var tick := session.world.tick
	await _frames(10)
	_expect(session.world.tick == tick, "time stands still while paused")
	await _press(&"ui_accept")
	_expect(session.state == GameSession.State.PLAYING, "RETURN TO GAME resumes")

	# Collect every diamond by moving the ball onto it.
	var deadline := Time.get_ticks_msec() + TIMEOUT_MSEC
	while session.state == GameSession.State.PLAYING and Time.get_ticks_msec() < deadline:
		for d in session.world.diamonds:
			if d.alive and d.fade == 0.0:
				session.world.override_ball(d.point.position, Vector3.ZERO)
				break
		await _frames(1)
	_expect(session.world.finished, "level completes when all diamonds are collected")
	while session.state == GameSession.State.FINISHING and Time.get_ticks_msec() < deadline:
		await _frames(1)
	_expect(session.state == GameSession.State.NAME_ENTRY, "a record asks for initials")
	await _type(KEY_T, "t".unicode_at(0))
	await _type(KEY_S, "s".unicode_at(0))
	await _type(KEY_T, "t".unicode_at(0))
	await _type(KEY_ENTER)
	_expect(session.state == GameSession.State.LEVEL_MENU, "level menu after entering name")
	var best := Records.best("bounce")
	_expect(best.get("name", "") == "TST", "record saved with initials (%s)" % best)
	_expect(Records.best_replay("bounce") != null and Records.best_replay("bounce").size() > 0, "best-time replay saved")

	await _press(&"ui_down")  # RESTART LEVEL -> SHOW REPLAY
	await _press(&"ui_accept")
	_expect(session.state == GameSession.State.REPLAYING, "SHOW REPLAY plays the run back")
	while session.state == GameSession.State.REPLAYING and Time.get_ticks_msec() < deadline:
		await _frames(1)
	_expect(session.state == GameSession.State.LEVEL_MENU, "replay returns to the level menu")
	await _press(&"ui_up")  # wraps to QUIT TO MENU
	await _press(&"ui_accept")
	_expect(exited[0], "QUIT TO MENU leaves the session")
	session.queue_free()
	await _frames(2)


func _cleanup() -> void:
	for f in DirAccess.get_files_at("user://smoke_test/replays"):
		DirAccess.remove_absolute("user://smoke_test/replays/" + f)
	DirAccess.remove_absolute("user://smoke_test/replays")
	DirAccess.remove_absolute("user://smoke_test/records.cfg")
	DirAccess.remove_absolute("user://smoke_test")
