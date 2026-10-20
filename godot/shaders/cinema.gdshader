shader_type canvas_item;
// « Effets cinéma » (Options) : vignette et grain de pellicule, comme les calques CSS de index.html (#cinema) :
//   vignette : dégradé radial ellipse 78 % x 72 %, transparent jusqu'à 52 %, noir 0,30 à 80 %, 0,66 à 100 % ;
//   grain : bruit de gris, opacité 0,085, mélange « overlay », qui saute 4 fois en 0,6 s (steps(4)).

uniform sampler2D screen_tex : hint_screen_texture, filter_nearest;
uniform float grain = 0.085;
uniform float vignette_on = 1.0;

uint pcg(uint v) {
	uint s = v * 747796405u + 2891336453u;
	uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
	return (w >> 22u) ^ w;
}
// bruit entier PCG sur des coordonnées entières (sans sin ni grandes valeurs flottantes : pas de motif de trame selon le GPU) -> [0, 1)
float hash(vec2 p, float step_t) {
	uvec2 q = uvec2(ivec2(p));
	uint h = pcg(q.x + pcg(q.y + pcg(uint(step_t))));
	return float(h >> 8u) * (1.0 / 16777216.0);
}

void fragment() {
	vec3 base = texture(screen_tex, SCREEN_UV).rgb;
	float t = length((SCREEN_UV - 0.5) / vec2(0.78, 0.72));
	float v = t < 0.52 ? 0.0 : (t < 0.80 ? 0.30 * (t - 0.52) / 0.28 : 0.30 + 0.36 * clamp((t - 0.80) / 0.20, 0.0, 1.0));
	vec3 col = base * (1.0 - v * vignette_on);
	float step_t = floor(TIME / 0.15);
	float n = hash(floor(FRAGCOORD.xy), step_t);
	vec3 g = vec3(n);
	// overlay : base < 0,5 ? 2 x base x g : 1 - 2 x (1 - base) x (1 - g)
	vec3 ov = mix(2.0 * col * g, 1.0 - 2.0 * (1.0 - col) * (1.0 - g), step(0.5, col));
	COLOR = vec4(mix(col, ov, grain), 1.0);
}
