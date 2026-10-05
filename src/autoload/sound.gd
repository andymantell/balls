extends Node
## Sound effects and music. Sample names match the original WAV files.

const SOUND_DIR := "res://assets/sounds/"
const MUSIC_DIR := "res://assets/music/"
const SAMPLES: Array[StringName] = [&"boun", &"dia", &"thun", &"end", &"start", &"endbest", &"bnormal", &"bred", &"bgreen", &"bblue", &"byellow"]
const VOICES := 12

var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _next := 0
var _music: AudioStreamPlayer
var _music_name := ""


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for s in SAMPLES:
		_streams[s] = load(SOUND_DIR + String(s) + ".wav")
	for i in VOICES:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	_music = AudioStreamPlayer.new()
	add_child(_music)
	Settings.changed.connect(_apply_volume)
	_apply_volume()


## Plays a sample. [param volume] is linear 0..1 (the original used 0..63).
func play(sample: StringName, volume := 1.0) -> void:
	var stream: AudioStream = _streams.get(sample)
	if stream == null or volume <= 0.0:
		return
	var p := _players[_next]
	_next = (_next + 1) % _players.size()
	p.stream = stream
	p.volume_db = linear_to_db(clampf(volume, 0.0, 1.0) * Settings.sfx_volume)
	p.play()


func play_music(track: String) -> void:
	if track == _music_name and _music.playing:
		return
	_music_name = track
	var stream := load(MUSIC_DIR + track + ".ogg") as AudioStreamOggVorbis
	if stream == null:
		return
	stream.loop = true
	_music.stream = stream
	_apply_volume()
	_music.play()


func stop_music() -> void:
	_music_name = ""
	_music.stop()


func _apply_volume() -> void:
	if _music:
		_music.volume_db = linear_to_db(maxf(Settings.music_volume, 0.0001))
