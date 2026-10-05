extends Node
## Root of the game: switches between the menu and game sessions and handles
## global keys (Alt+Enter / F11 fullscreen, F2 graphics, F12 quick quit).
##
## Developer options (after "--" on the command line):
##   --map=<id>           start this level directly
##   --replay             play the level's best-time replay instead
##   --menu               start in the menu (default)
##   --screenshot=<path>  save a screenshot after --frames=<n> frames and quit

var _current: Node
var _args := {}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else ""
	if _args.has("map"):
		var id: String = _args["map"]
		if _args.has("replay"):
			_watch_replay(id)
		else:
			_play([id] as Array[String], 0, false)
	else:
		_show_menu()
	if _args.has("screenshot"):
		_take_screenshot.call_deferred(_args["screenshot"], int(_args.get("frames", "60")))


func _take_screenshot(path: String, frames: int) -> void:
	for i in frames:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("Screenshot saved to ", path)
	get_tree().quit()


func _switch_to(node: Node) -> void:
	if _current:
		_current.queue_free()
	_current = node
	add_child(node)


func _show_menu() -> void:
	var menu := MenuScreen.new()
	menu.start_campaign.connect(func(): _play(Records.CAMPAIGN, 0, true))
	menu.start_map.connect(func(id: String): _play([id] as Array[String], 0, false))
	menu.watch_replay.connect(_watch_replay)
	menu.quit_requested.connect(get_tree().quit)
	_switch_to(menu)


func _play(ids: Array[String], index: int, campaign: bool) -> void:
	var session := GameSession.new().configure(ids, index, campaign)
	session.exited.connect(_show_menu)
	_switch_to(session)


func _watch_replay(id: String) -> void:
	var replay := Records.best_replay(id)
	if replay == null:
		_show_menu()
		return
	var session := GameSession.new().configure([id] as Array[String], 0, false, replay)
	session.exited.connect(_show_menu)
	_switch_to(session)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"toggle_fullscreen"):
		Settings.toggle_fullscreen()
	elif event.is_action_pressed(&"quick_quit"):
		get_tree().quit()
	elif event.is_action_pressed(&"cycle_graphics"):
		Settings.lighting = 1 - Settings.lighting
		Settings.save_settings()
		Settings.apply()
	else:
		return
	get_viewport().set_input_as_handled()
