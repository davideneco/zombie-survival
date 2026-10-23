shader_type spatial;
render_mode cull_disabled;
// v0.32.4 : touffes d'herbe des pelouses (scenes/world/vegetation_view.gd) : brins dessinés au chargement (alpha), vent, translucidité, pied assombri.
uniform sampler2D blades : source_color, filter_linear_mipmap, repeat_disable;
varying float hfrac;
void vertex() {
	hfrac = clamp(VERTEX.y / 0.45, 0.0, 1.0);
	vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float s = sin(TIME * 2.1 + w.x * 0.7 + w.z * 0.5) * 0.06 * hfrac * hfrac;
	VERTEX.x += s;
	VERTEX.z += s * 0.6;
}
void fragment() {
	vec4 t = texture(blades, UV);
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = 0.45;
	ALPHA_ANTIALIASING_EDGE = 0.3;
	vec3 col = t.rgb * (0.55 + 0.45 * hfrac);
	ALBEDO = col;
	ROUGHNESS = 0.85;
	BACKLIGHT = col * 0.6;
	if (!FRONT_FACING) { NORMAL = -NORMAL; }
}
