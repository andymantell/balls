shader_type sky;
// The original engine "rolls" a tiling bitmap behind the scene: it scrolls
// horizontally as the camera turns and vertically as it pitches.

uniform sampler2D background : source_color, repeat_enable, filter_linear_mipmap;
uniform float horizontal_repeats = 4.0;
uniform float vertical_scale = 1.3;

void sky() {
	float yaw = atan(EYEDIR.x, -EYEDIR.z) / TAU;
	float pitch = asin(clamp(EYEDIR.y, -1.0, 1.0)) / PI;
	vec2 uv = vec2(yaw * horizontal_repeats, 0.5 - pitch * vertical_scale * horizontal_repeats * 0.5);
	COLOR = texture(background, uv).rgb;
}
