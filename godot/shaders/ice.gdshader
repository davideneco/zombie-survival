// v0.34.0 : glace du lac gelé et de la piscine de l'hôtel (Station des Aiguilles) : bleu-vert profond sous une surface lisse, fissures, bulles
// prises dans la glace, plaques de neige soufflée ; reflet du ciel (env_reflect.gdshaderinc, qui suit le jour et la nuit).
shader_type spatial;
render_mode cull_back;

#include "res://shaders/env_reflect.gdshaderinc"

uniform sampler2D snow_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform vec3 deep : source_color = vec3(0.10, 0.22, 0.28);
uniform vec3 shallow : source_color = vec3(0.45, 0.62, 0.70);
uniform float snow_amount = 0.45;

varying vec3 w_pos;

void vertex() {
	w_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// distance aux bords des cellules de Voronoï : fissures
float cracks(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float d1 = 8.0;
	float d2 = 8.0;
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 g = vec2(float(x), float(y));
			vec2 o = vec2(hash12(i + g), hash12(i + g + 17.3));
			float d = length(g + o - f);
			if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
		}
	}
	return d2 - d1;
}

void fragment() {
	vec2 p = w_pos.xz;
	float depth = vnoise(p * 0.05);
	vec3 col = mix(deep, shallow, depth * 0.7 + 0.15);
	float c = cracks(p * 0.22) ;
	float c2 = cracks(p * 0.9 + 3.1);
	float crack = (1.0 - smoothstep(0.0, 0.04, c)) * 0.55 + (1.0 - smoothstep(0.0, 0.025, c2)) * 0.25;
	col = mix(col, vec3(0.82, 0.9, 0.95), crack);
	float bubbles = step(0.985, hash12(floor(p * 9.0))) * 0.3;
	col += bubbles;
	float sn = smoothstep(0.5, 0.75, vnoise(p * 0.08) * 0.7 + vnoise(p * 0.5) * 0.3) * snow_amount * 2.0;
	vec3 salb = texture(snow_tex, p * 0.3).rgb * 2.0 * vec3(0.9, 0.93, 0.98);
	sn = clamp(sn, 0.0, 1.0);
	ALBEDO = mix(col, salb, sn);
	ROUGHNESS = mix(0.06 + crack * 0.3, 0.75, sn);
	SPECULAR = 0.6;
	vec3 nv = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	vec3 vd = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);
	vec3 r = reflect(-vd, nv);
	float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(nv, vd), 0.0, 1.0), 5.0);
	EMISSION = env_sky(r) * fres * (1.0 - sn) * 2.5;
}
