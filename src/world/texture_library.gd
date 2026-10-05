class_name TextureLibrary
extends RefCounted
## Resolves the 8.3 bitmap names referenced by .3DO files to textures.
## Names are case-insensitive (the original ran on Windows).

const BUILTIN_DIR := "res://assets/textures/"

var extra_dirs: PackedStringArray = []
var _cache := {}


func get_texture(bitmap_name: String) -> Texture2D:
	var key := bitmap_name.get_basename().to_lower()
	if key.is_empty():
		return null
	if _cache.has(key):
		return _cache[key]
	var tex: Texture2D = null
	var builtin := BUILTIN_DIR + key + ".png"
	if ResourceLoader.exists(builtin):
		tex = load(builtin)
	else:
		tex = _load_external(key)
	if tex == null:
		push_warning("Texture '%s' not found" % bitmap_name)
	_cache[key] = tex
	return tex


## Custom levels may ship their own BMP/PNG files next to the .3DO.
func _load_external(key: String) -> Texture2D:
	for dir in extra_dirs:
		for f in DirAccess.get_files_at(dir):
			if f.get_basename().to_lower() == key and f.get_extension().to_lower() in ["bmp", "png"]:
				var img := Image.load_from_file(dir.path_join(f))
				if img:
					img.generate_mipmaps()
					return ImageTexture.create_from_image(img)
	return null
