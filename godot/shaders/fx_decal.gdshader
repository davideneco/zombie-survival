shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, unshaded;
// Taches de sang (sol et murs) de src/fx.js : MeshBasicMaterial teinté 0x4a0707 x atlas de 4 variantes (2 x 2) ; couleur et opacité par instance
// (INSTANCE_CUSTOM : x = variante 0..3, y = opacité). Un seul MultiMesh pour toutes les taches.

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;

varying vec2 v_uv;
varying float v_alpha;

void vertex() {
	float cell = INSTANCE_CUSTOM.x;
	v_alpha = INSTANCE_CUSTOM.y;
	v_uv = vec2((UV.x + mod(cell, 2.0)) * 0.5, 0.5 * (floor(cell / 2.0) + UV.y));
}

void fragment() {
	vec4 t = texture(atlas, v_uv);
	ALBEDO = COLOR.rgb;
	ALPHA = t.a * v_alpha;
}
