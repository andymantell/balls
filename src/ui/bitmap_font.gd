class_name BitmapFont
extends RefCounted
## Builds a Godot [FontFile] from the original 64 px bitmap font (ifont1-3.bmp),
## so regular [Label]s can use it. Lowercase letters map to the capitals and
## '*' is the diamond icon.

const ATLAS := "res://assets/fonts/balls_font.png"
const METRICS := "res://assets/fonts/balls_font.json"
const SIZE := 64
const ASCENT := 56
const SPACING := 4
const SPACE_ADVANCE := 22

static var _font: FontFile


static func get_font() -> FontFile:
	if _font:
		return _font
	var font := FontFile.new()
	font.fixed_size = SIZE
	font.fixed_size_scale_mode = TextServer.FIXED_SIZE_SCALE_ENABLED
	var size := Vector2i(SIZE, 0)
	var tex := load(ATLAS) as Texture2D
	font.set_texture_image(0, size, 0, tex.get_image())
	font.set_cache_ascent(0, SIZE, ASCENT)
	font.set_cache_descent(0, SIZE, SIZE - ASCENT)
	var metrics: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(METRICS))
	for g in metrics["glyphs"]:
		var ch: String = g["char"]
		var w := float(g["w"])
		var rect := Rect2(g["x"], g["y"], w, SIZE)
		for code in _codes_for(ch):
			font.set_glyph_advance(0, SIZE, code, Vector2(w + SPACING, 0))
			font.set_glyph_offset(0, size, code, Vector2(0, -ASCENT))
			font.set_glyph_size(0, size, code, Vector2(w, SIZE))
			font.set_glyph_uv_rect(0, size, code, rect)
			font.set_glyph_texture_idx(0, size, code, 0)
	font.set_glyph_advance(0, SIZE, " ".unicode_at(0), Vector2(SPACE_ADVANCE, 0))
	_font = font
	return font


static func _codes_for(ch: String) -> Array[int]:
	var codes: Array[int] = [ch.unicode_at(0)]
	if ch.to_lower() != ch:
		codes.append(ch.to_lower().unicode_at(0))
	return codes


## A shared theme using the bitmap font.
static func make_theme(font_size := 40) -> Theme:
	var t := Theme.new()
	t.default_font = get_font()
	t.default_font_size = font_size
	return t
