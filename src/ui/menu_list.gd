class_name MenuList
extends VBoxContainer
## Keyboard driven vertical menu drawn with the original bitmap font.
## Items can carry a value column (e.g. "MUSIC  70%").

signal activated(index: int)
signal cancelled
signal adjusted(index: int, direction: int)

const COLOR_NORMAL := Color(0.62, 0.85, 1.0)
const COLOR_SELECTED := Color(1.0, 0.95, 0.35)
const COLOR_DISABLED := Color(0.35, 0.4, 0.5)

@export var font_size := 46
@export var visible_rows := 9
@export var title := ""

var selected := 0
var active := true
var _items: Array[String] = []
var _values: Array[String] = []
var _disabled: Array[bool] = []
var _scroll := 0
var _rows: Array[HBoxContainer] = []
var _title_label: Label


func _ready() -> void:
	alignment = BoxContainer.ALIGNMENT_CENTER
	add_theme_constant_override("separation", 2)
	_rebuild()


func set_items(items: Array, values: Array = []) -> void:
	_items.assign(items)
	_values.clear()
	_disabled.clear()
	for i in _items.size():
		_values.append(str(values[i]) if i < values.size() else "")
		_disabled.append(false)
	selected = clampi(selected, 0, maxi(_items.size() - 1, 0))
	_rebuild()


func set_value(index: int, value: String) -> void:
	_values[index] = value
	_refresh()


func set_disabled(index: int, disabled: bool) -> void:
	_disabled[index] = disabled
	_refresh()


func select(index: int) -> void:
	selected = clampi(index, 0, maxi(_items.size() - 1, 0))
	_refresh()


func _rebuild() -> void:
	if not is_inside_tree():
		return
	for c in get_children():
		c.queue_free()
	_rows.clear()
	_title_label = null
	if not title.is_empty():
		_title_label = _label(title, font_size + 12, HORIZONTAL_ALIGNMENT_CENTER)
		_title_label.modulate = Color(1, 0.55, 0.3)
		add_child(_title_label)
	for i in mini(visible_rows, _items.size()):
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		row.add_theme_constant_override("separation", 28)
		row.add_child(_label("", font_size, HORIZONTAL_ALIGNMENT_CENTER))
		var value := _label("", font_size, HORIZONTAL_ALIGNMENT_LEFT)
		row.add_child(value)
		add_child(row)
		_rows.append(row)
	_refresh()


func _label(text: String, size: int, align: HorizontalAlignment) -> Label:
	var l := Label.new()
	l.text = text
	l.horizontal_alignment = align
	l.add_theme_font_override("font", BitmapFont.get_font())
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_constant_override("outline_size", 0)
	return l


func _refresh() -> void:
	if _rows.is_empty():
		return
	if selected < _scroll:
		_scroll = selected
	elif selected >= _scroll + _rows.size():
		_scroll = selected - _rows.size() + 1
	for r in _rows.size():
		var i := _scroll + r
		var row := _rows[r]
		var name_label := row.get_child(0) as Label
		var value_label := row.get_child(1) as Label
		name_label.text = _items[i]
		value_label.text = _values[i]
		value_label.visible = not _values[i].is_empty()
		var color := COLOR_DISABLED if _disabled[i] else (COLOR_SELECTED if i == selected and active else COLOR_NORMAL)
		row.modulate = color
		var s := 1.12 if i == selected else 1.0
		row.pivot_offset = row.size * 0.5
		row.scale = Vector2(s, s)


func _unhandled_input(event: InputEvent) -> void:
	if not active or not is_visible_in_tree() or _items.is_empty():
		return
	if event.is_action_pressed(&"ui_up") or event.is_action_pressed(&"ball_up"):
		_move(-1)
	elif event.is_action_pressed(&"ui_down") or event.is_action_pressed(&"ball_down"):
		_move(1)
	elif event.is_action_pressed(&"ui_left") or event.is_action_pressed(&"ball_left"):
		adjusted.emit(selected, -1)
	elif event.is_action_pressed(&"ui_right") or event.is_action_pressed(&"ball_right"):
		adjusted.emit(selected, 1)
	elif event.is_action_pressed(&"ui_accept") or event.is_action_pressed(&"ball_action"):
		if not _disabled[selected]:
			Sound.play(&"dia", 0.5)
			activated.emit(selected)
	elif event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"pause_menu"):
		cancelled.emit()
	else:
		return
	get_viewport().set_input_as_handled()


func _move(dir: int) -> void:
	var n := _items.size()
	var i := selected
	for _k in n:
		i = (i + dir + n) % n
		if not _disabled[i]:
			break
	selected = i
	Sound.play(&"boun", 0.35)
	_refresh()
