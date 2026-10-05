class_name ModelBuilder
extends RefCounted
## Turns .3DO mesh objects into Godot meshes and materials.

const ADDITIVE := 2
const SUBTRACTIVE := 3

var textures: TextureLibrary
var lighting := 0  ## Settings.Lighting
var specular := false
var _materials := {}


func _init(texture_library: TextureLibrary, lighting_mode := 0, use_specular := false) -> void:
	textures = texture_library
	lighting = lighting_mode
	specular = use_specular


## Mesh in the object's local space (relative to its pivot, Godot axes).
func build_mesh(m: ThreeDoFile.MeshObject) -> ArrayMesh:
	var pivot := Coords.from_d3d(m.pivot)
	var positions := PackedVector3Array()
	positions.resize(m.vertices.size())
	for i in m.vertices.size():
		positions[i] = Coords.from_d3d(m.vertices[i]) - pivot

	var fc := m.face_count()
	var face_normals := PackedVector3Array()
	face_normals.resize(fc)
	var smooth := PackedVector3Array()
	smooth.resize(positions.size())
	for f in fc:
		var a := positions[m.faces[f * 7]]
		var n := (positions[m.faces[f * 7 + 2]] - a).cross(positions[m.faces[f * 7 + 1]] - a).normalized()
		face_normals[f] = n
		if m.faces[f * 7 + 6] != 0:
			for k in 3:
				smooth[m.faces[f * 7 + k]] += n

	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	verts.resize(fc * 3)
	normals.resize(fc * 3)
	uvs.resize(fc * 3)
	for f in fc:
		var smoothed := m.faces[f * 7 + 6] != 0
		for k in 3:
			var vi := m.faces[f * 7 + k]
			var ti := m.faces[f * 7 + 3 + k]
			verts[f * 3 + k] = positions[vi]
			var n := smooth[vi].normalized() if smoothed and smooth[vi] != Vector3.ZERO else face_normals[f]
			normals[f * 3 + k] = n
			uvs[f * 3 + k] = m.uvs[ti] if ti >= 0 and ti < m.uvs.size() else Vector2.ZERO
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	var mesh := ArrayMesh.new()
	if fc > 0:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(0, material_for(m))
	return mesh


func material_for(m: ThreeDoFile.MeshObject) -> StandardMaterial3D:
	var key := "%s|%s|%s|%d|%.3f|%.3f|%s" % [m.texture.to_lower(), m.diffuse, m.ambient, m.blend_mode, m.transparency, m.self_illumination, m.two_sided]
	if _materials.has(key):
		return _materials[key]
	var mat := StandardMaterial3D.new()
	var tex := textures.get_texture(m.texture)
	mat.albedo_color = m.diffuse
	mat.albedo_texture = tex
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	mat.texture_repeat = true
	mat.metallic_specular = 0.5 if specular else 0.0
	mat.roughness = 0.45
	if lighting == 1:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
	# D3D material "ambient" acts as a glow colour; self illumination adds to it.
	var glow := Color(m.ambient.r + m.self_illumination, m.ambient.g + m.self_illumination, m.ambient.b + m.self_illumination)
	if glow.r > 0.0 or glow.g > 0.0 or glow.b > 0.0:
		mat.emission_enabled = true
		mat.emission = glow
		mat.emission_texture = tex
		mat.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
	if m.two_sided:
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	if m.blend_mode == ADDITIVE:
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	elif m.blend_mode == SUBTRACTIVE:
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_SUB
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	elif m.transparency > 0.0:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.albedo_color.a = 1.0 - m.transparency
	_materials[key] = mat
	return mat


## Builds a whole model file (ball, diamond, menu) as a Node3D tree.
## Each object becomes a child MeshInstance3D named after its index.
func build_model(file: ThreeDoFile) -> Node3D:
	var root := Node3D.new()
	for i in file.objects.size():
		var m := file.objects[i]
		var mi := MeshInstance3D.new()
		mi.name = "Object%d" % i
		mi.mesh = build_mesh(m)
		mi.position = Coords.from_d3d(m.pivot)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.set_meta("spin", Vector3(m.spin) * SimObject.SPIN_SCALE)
		mi.set_meta("special", m.special)
		root.add_child(mi)
	return root
