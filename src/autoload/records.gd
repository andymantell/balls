extends Node
## Level catalogue and best times / best-time replays.
##
## Built-in levels live in res://assets/maps. Custom levels made with the
## original MAKEMAP.EXE can be dropped into user://maps (with their textures in
## user://maps or res://assets/textures) and appear in SINGLE MAP.

const BUILTIN_DIR := "res://assets/maps/"
const USER_DIR := "user://maps/"
const REPLAY_DIR := "user://replays/"

## Order of the 12 levels in START GAME, as in BALLS.EXE v1.02.
const CAMPAIGN: Array[String] = ["lazer_maze", "chase", "bounce", "disco", "loops", "rollercoaster",
	"city", "castle", "cannon", "jump", "killer", "nightmare"]


class MapInfo:
	extends RefCounted
	var id: String
	var title: String
	var path: String
	var builtin: bool


## Overridable for tests.
var records_path := "user://records.cfg"
var replay_dir := REPLAY_DIR
var maps: Array[MapInfo] = []
var _records := ConfigFile.new()


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(USER_DIR)
	DirAccess.make_dir_recursive_absolute(REPLAY_DIR)
	_records.load(records_path)
	refresh()


## Points record storage somewhere else (used by tests).
func use_storage(path: String, replays: String) -> void:
	records_path = path
	replay_dir = replays
	DirAccess.make_dir_recursive_absolute(replays)
	_records = ConfigFile.new()
	_records.load(records_path)


func refresh() -> void:
	maps.clear()
	var seen := {}
	for id in CAMPAIGN:
		_add(id, BUILTIN_DIR + id + ".3do", true, seen)
	for dir in [BUILTIN_DIR, USER_DIR]:
		var files := DirAccess.get_files_at(dir)
		files.sort()
		for f in files:
			if f.get_extension().to_lower() == "3do":
				_add(f.get_basename().to_lower(), dir + f, dir == BUILTIN_DIR, seen)


func _add(id: String, path: String, builtin: bool, seen: Dictionary) -> void:
	if seen.has(id) or not FileAccess.file_exists(path):
		return
	seen[id] = true
	var m := MapInfo.new()
	m.id = id
	m.title = id.replace("_", " ").to_upper()
	m.path = path
	m.builtin = builtin
	maps.append(m)


func find(id: String) -> MapInfo:
	for m in maps:
		if m.id == id:
			return m
	return null


func campaign_index(id: String) -> int:
	return CAMPAIGN.find(id)


## {"time_ms": int, "name": String} or {} if the level has no record yet.
func best(id: String) -> Dictionary:
	if _records.has_section_key(id, "time_ms"):
		return {"time_ms": _records.get_value(id, "time_ms"), "name": _records.get_value(id, "name", "")}
	var m := find(id)
	if m:
		return ReplayFile.load_record(m.path.get_basename() + ".rec")
	return {}


func is_record(id: String, time_ms: int) -> bool:
	var b := best(id)
	return b.is_empty() or time_ms < b["time_ms"]


func submit(id: String, time_ms: int, initials: String, replay: ReplayFile) -> void:
	_records.set_value(id, "time_ms", time_ms)
	_records.set_value(id, "name", initials.substr(0, 3).to_upper())
	_records.save(records_path)
	if replay:
		replay.save_file(replay_dir + id + ".rep")


func best_replay(id: String) -> ReplayFile:
	if _records.has_section_key(id, "time_ms") and FileAccess.file_exists(replay_dir + id + ".rep"):
		return ReplayFile.load_file(replay_dir + id + ".rep")
	var m := find(id)
	if m and FileAccess.file_exists(m.path.get_basename() + ".rep"):
		return ReplayFile.load_file(m.path.get_basename() + ".rep")
	return null


static func format_time(ms: int) -> String:
	return "%d.%02d" % [ms / 1000, (ms % 1000) / 10]
