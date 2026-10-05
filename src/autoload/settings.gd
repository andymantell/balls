extends Node
## Persistent user settings (user://settings.cfg) and input remapping.

signal changed

const PATH := "user://settings.cfg"
const REMAPPABLE_ACTIONS: Array[StringName] = [&"ball_up", &"ball_down", &"ball_left", &"ball_right", &"ball_action", &"restart_level", &"toggle_camera"]

enum Lighting { MODERN, CLASSIC }

var music_volume := 0.7
var sfx_volume := 0.9
var fullscreen := false
var msaa := true
var lighting := Lighting.MODERN
var glows := true
## The original's SPECULAR option (OFF by default, as in BALLS.EXE).
var specular := false
var classic_acceleration := true
var view_distance := 4000.0
var show_fps := false

var _defaults := {}


func _ready() -> void:
	for action in REMAPPABLE_ACTIONS:
		_defaults[action] = InputMap.action_get_events(action)
	load_settings()
	apply()


func load_settings() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(PATH) != OK:
		return
	music_volume = cfg.get_value("audio", "music_volume", music_volume)
	sfx_volume = cfg.get_value("audio", "sfx_volume", sfx_volume)
	fullscreen = cfg.get_value("video", "fullscreen", fullscreen)
	msaa = cfg.get_value("video", "msaa", msaa)
	lighting = cfg.get_value("video", "lighting", lighting)
	glows = cfg.get_value("video", "glows", glows)
	specular = cfg.get_value("video", "specular", specular)
	view_distance = cfg.get_value("video", "view_distance", view_distance)
	show_fps = cfg.get_value("video", "show_fps", show_fps)
	classic_acceleration = cfg.get_value("game", "classic_acceleration", classic_acceleration)
	for action in REMAPPABLE_ACTIONS:
		var key = cfg.get_value("keys", action, null)
		if key is int and key != 0:
			set_key(action, key, false)


func save_settings() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("audio", "music_volume", music_volume)
	cfg.set_value("audio", "sfx_volume", sfx_volume)
	cfg.set_value("video", "fullscreen", fullscreen)
	cfg.set_value("video", "msaa", msaa)
	cfg.set_value("video", "lighting", lighting)
	cfg.set_value("video", "glows", glows)
	cfg.set_value("video", "specular", specular)
	cfg.set_value("video", "view_distance", view_distance)
	cfg.set_value("video", "show_fps", show_fps)
	cfg.set_value("game", "classic_acceleration", classic_acceleration)
	for action in REMAPPABLE_ACTIONS:
		cfg.set_value("keys", action, get_key(action))
	cfg.save(PATH)


func apply() -> void:
	if DisplayServer.get_name() != "headless":
		var mode := DisplayServer.WINDOW_MODE_FULLSCREEN if fullscreen else DisplayServer.WINDOW_MODE_WINDOWED
		if DisplayServer.window_get_mode() != mode:
			DisplayServer.window_set_mode(mode)
	get_viewport().msaa_3d = Viewport.MSAA_4X if msaa else Viewport.MSAA_DISABLED
	changed.emit()


## Physical keycode of the first keyboard binding of [param action] (0 = none).
func get_key(action: StringName) -> int:
	for e in InputMap.action_get_events(action):
		if e is InputEventKey:
			return e.physical_keycode if e.physical_keycode != 0 else e.keycode
	return 0


func set_key(action: StringName, keycode: int, persist := true) -> void:
	for e in InputMap.action_get_events(action):
		if e is InputEventKey:
			InputMap.action_erase_event(action, e)
	var ev := InputEventKey.new()
	ev.physical_keycode = keycode as Key
	InputMap.action_add_event(action, ev)
	if persist:
		save_settings()


func reset_keys() -> void:
	for action in REMAPPABLE_ACTIONS:
		InputMap.action_erase_events(action)
		for e in _defaults[action]:
			InputMap.action_add_event(action, e)
	save_settings()


func toggle_fullscreen() -> void:
	fullscreen = not fullscreen
	apply()
	save_settings()
