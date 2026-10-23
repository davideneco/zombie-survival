shader_type spatial;
render_mode cull_disabled;
// v0.24.2 : vitraux de la cathédrale vus de l'extérieur : plombs et cellules colorées par hachage de la position locale (rosace : secteurs colorés), éclairés de l'intérieur la nuit.
uniform vec3 center = vec3(0.0, 33.0, 0.0);     // centre de la rosace (x, y, z locaux)
uniform float rose = 0.0;                         // 1 : motif radial
uniform float night = 1.0;
uniform float glow = 1.3;
uniform float cell = 0.55;
uniform float world_map = 0.0;                    // v0.32.0 : 1 : motif dans le plan de la face en mètres du monde (vitraux de la nef, des tours, de l'intérieur)

varying vec3 lp;
varying vec3 wp;
varying vec3 wn;

void vertex() {
	lp = VERTEX;
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = normalize(MODEL_NORMAL_MATRIX * NORMAL);
}

float h21(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec3 palette(float h) {
	if (h < 0.28) return vec3(0.05, 0.12, 0.55);   // bleu profond
	if (h < 0.48) return vec3(0.55, 0.05, 0.08);   // rouge rubis
	if (h < 0.66) return vec3(0.95, 0.62, 0.10);   // ambre
	if (h < 0.80) return vec3(0.08, 0.40, 0.18);   // vert
	return vec3(0.55, 0.25, 0.60);                 // violet
}

void fragment() {
	vec2 p = lp.zy;
	if (world_map > 0.5) {
		vec3 T = cross(vec3(0.0, 1.0, 0.0), wn);
		T = dot(T, T) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(T);
		p = vec2(dot(wp, T), wp.y);
	}
	vec2 c;
	float lead;
	if (rose > 0.5) {
		vec2 d = p - center.zy;
		float r = length(d);
		float ang = atan(d.y, d.x);
		float sector = floor((ang + 3.14159) / (6.28318 / 16.0));
		float ring = floor(r / 1.15);
		c = vec2(sector, ring);
		float sa = fract((ang + 3.14159) / (6.28318 / 16.0));
		float sr = fract(r / 1.15);
		lead = 1.0 - smoothstep(0.0, 0.07, min(min(sa, 1.0 - sa) * r * 0.39, sr));
	} else {
		c = floor(p / cell);
		vec2 f = fract(p / cell);
		lead = 1.0 - smoothstep(0.0, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
	}
	float h = h21(c);
	vec3 col = palette(h) * (0.55 + 0.8 * h21(c + 7.7));
	col = mix(col, vec3(0.02), lead);
	// v0.32.0 : vu du dehors en plein jour un vitrail est sombre (le verre coloré ne se lit que par transparence) : albédo presque noir teinté, reflet du ciel par la
	// faible rugosité ; la nuit, la lumière intérieure le fait briller (EMISSION x night)
	ALBEDO = mix(vec3(0.025, 0.03, 0.04), col * 0.25, 0.3);
	ROUGHNESS = 0.12;
	METALLIC = 0.0;
	EMISSION = col * (1.0 - lead) * glow * night;
}
