class_name Hud
extends CanvasLayer
## In-game overlay: timer, best time, diamonds left, messages and fades.

var _time: Label
var _best: Label
var _diamonds: Label
var _message: Label
var _sub_message: Label
var _fps: Label
var _fade: ColorRect
var _fade_tween: Tween


func _ready() -> void:
	layer = 5
	_time = _make_label(40, Vector2(24, 12))
	_best = _make_label(32, Vector2(-24, 12), true)
	_diamonds = _make_label(40, Vector2(24, -64))
	_diamonds.anchor_top = 1.0
	_diamonds.anchor_bottom = 1.0
	_fps = _make_label(24, Vector2(-24, -40), true)
	_fps.anchor_top = 1.0
	_fps.anchor_bottom = 1.0
	_message = _make_center_label(72, -190)
	_sub_message = _make_center_label(44, -120)
	_fade = ColorRect.new()
	_fade.color = Color(0, 0, 0, 0)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_fade)


func _make_label(size: int, offset: Vector2, right := false) -> Label:
	var l := Label.new()
	l.add_theme_font_override("font", BitmapFont.get_font())
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("shadow_offset_x", 3)
	l.add_theme_constant_override("shadow_offset_y", 3)
	if right:
		l.anchor_left = 1.0
		l.anchor_right = 1.0
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		l.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	l.position = offset
	add_child(l)
	return l


func _make_center_label(size: int, y: float) -> Label:
	var l := _make_label(size, Vector2.ZERO)
	l.anchor_left = 0.0
	l.anchor_right = 1.0
	l.anchor_top = 0.5
	l.anchor_bottom = 0.5
	l.offset_left = 0.0
	l.offset_right = 0.0
	l.offset_top = y - size * 0.5
	l.offset_bottom = y + size * 0.5
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.modulate = Color(1, 0.9, 0.4)
	return l


func set_time(ms: int) -> void:
	_time.text = "TIME %s" % Records.format_time(ms)


func set_best(record: Dictionary) -> void:
	_best.text = "BEST %s %s" % [Records.format_time(record["time_ms"]), record["name"]] if not record.is_empty() else "BEST -"


func set_diamonds(left: int) -> void:
	_diamonds.text = "* %d" % left


func set_fps(fps: float, visible_fps: bool) -> void:
	_fps.visible = visible_fps
	_fps.text = "FPS %d" % roundi(fps)


func show_message(text: String, sub := "") -> void:
	_message.text = text
	_sub_message.text = sub
	_message.visible = not text.is_empty()
	_sub_message.visible = not sub.is_empty()


func set_play_info_visible(v: bool) -> void:
	_time.visible = v
	_best.visible = v
	_diamonds.visible = v


func fade(to_alpha: float, duration := 0.5) -> Tween:
	if _fade_tween:
		_fade_tween.kill()
	_fade_tween = create_tween()
	_fade_tween.tween_property(_fade, "color:a", to_alpha, duration)
	return _fade_tween
