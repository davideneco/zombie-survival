shader_type spatial;
render_mode cull_disabled;
// Feuillage des arbres : cartes de l'atlas (alphaTest 0,46, double face) avec l'ondulation légère au vent de src/trees.js :
// sway = sin(vent x 1,7 + x x 0,45 + z x 0,37) x amplitude x (0,4 + 0,6 x clamp(y x 0,18)), en x, et 0,7 fois en z (monde).

uniform sampler2D albedo_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform vec4 albedo : source_color = vec4(1.0);
uniform float roughness = 0.92;
uniform float alpha_cut = 0.46;
uniform float sway = 0.035;
uniform float wind_on = 1.0;

void vertex() {
	vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float s = sin(TIME * 1.7 + w.x * 0.45 + w.z * 0.37) * sway * (0.4 + 0.6 * clamp(w.y * 0.18, 0.0, 1.0)) * wind_on;
	vec3 off = vec3(s, 0.0, s * 0.7);
	VERTEX += (inverse(mat3(MODEL_MATRIX)) * off);
}

void fragment() {
	vec4 t = texture(albedo_tex, UV);
	if (t.a < alpha_cut) { discard; }
	ALBEDO = t.rgb * albedo.rgb * COLOR.rgb;
	ROUGHNESS = roughness;
	// la normale d'une carte vaut des deux côtés (normale de couronne) : pas de retournement de la face arrière
	if (!FRONT_FACING) { NORMAL = -NORMAL; }
}
