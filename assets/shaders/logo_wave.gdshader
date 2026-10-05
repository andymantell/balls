shader_type spatial;
render_mode unshaded, cull_disabled;
// The waving "BALLS" logo behind the main menu ("laineet" in the original).

uniform sampler2D logo : source_color, filter_linear_mipmap;
uniform float amplitude = 14.0;
uniform float speed = 1.6;
uniform float brightness = 1.0;

void vertex() {
	VERTEX.z += sin(VERTEX.x * 0.012 + TIME * speed) * amplitude + cos(VERTEX.y * 0.017 + TIME * speed * 0.7) * amplitude * 0.6;
}

void fragment() {
	ALBEDO = texture(logo, UV).rgb * brightness;
}
