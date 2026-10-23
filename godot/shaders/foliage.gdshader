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

uniform float vary = 1.0;           // v0.32.4 : variation de teinte par arbre, lumière à travers les feuilles (Normale et Haute)

float h11(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void fragment() {
	vec4 t = texture(albedo_tex, UV);
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = alpha_cut;
	ALPHA_ANTIALIASING_EDGE = 0.25;      // couverture alpha avec le MSAA de Haute : bords de feuilles moins crénelés
	vec3 col = t.rgb * albedo.rgb * COLOR.rgb;
	if (vary > 0.5) {
		// teinte propre à chaque carte (maille de 6 m : un arbre), feuilles plus jaunes au soleil, plus sombres et bleutées vers l'intérieur de la couronne
		vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
		float h = h11(floor(wp.xz / 6.0));
		col *= mix(vec3(0.86, 0.95, 0.80), vec3(1.10, 1.05, 0.82), h);
		col *= 0.82 + 0.3 * h11(floor(wp.xz / 1.3) + 3.1);
		BACKLIGHT = col * 0.55;          // translucidité : lumière du soleil à travers les feuilles
	}
	ALBEDO = col;
	ROUGHNESS = roughness;
	// la normale d'une carte vaut des deux côtés (normale de couronne) : pas de retournement de la face arrière
	if (!FRONT_FACING) { NORMAL = -NORMAL; }
}
