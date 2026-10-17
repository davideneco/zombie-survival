shader_type spatial;
render_mode cull_disabled;
#include "env_reflect.gdshaderinc"
// Eau de l'Ill : MeshStandardMaterial de realworld.js (0x0f2a3c, rugosité 0,08, métal 0,6, normale d'ondulations répétée tous les 6 m et qui dérive de
// (0,004 ; 0,0025) par seconde), avec une seconde couche de ridules qui va à contre-sens (la deuxième échelle casse la répétition).
// Reflète le ciel d'ambiance et la lune (rayonnement du ciel).

uniform sampler2D normal_tex : hint_normal, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec4 albedo : source_color = vec4(0.0588, 0.1647, 0.2353, 1.0);
uniform float roughness = 0.08;
uniform float metallic = 0.6;
uniform float normal_depth = 0.6;
uniform float uv_repeat = 0.16666667;
uniform vec2 drift = vec2(0.004, 0.0025);
uniform float layers = 2.0;           // 1 en qualité Rapide

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = UV * uv_repeat + drift * TIME;
	vec2 n = texture(normal_tex, uv).xy * 2.0 - 1.0;
	if (layers > 1.5) {
		vec2 n2 = texture(normal_tex, UV * uv_repeat * 2.7 - drift * 1.7 * TIME + vec2(0.31, 0.77)).xy * 2.0 - 1.0;
		n = (n + n2 * 0.6) / 1.3;
	}
	ALBEDO = albedo.rgb;
	ROUGHNESS = roughness;
	METALLIC = 0.0;
	SPECULAR = 0.0;
	NORMAL_MAP = vec3(n * 0.5 + 0.5, 1.0);
	NORMAL_MAP_DEPTH = normal_depth;
	// reflet : ciel d'ambiance (env_reflect.gdshaderinc) sous la normale ondulée, Fresnel de Schlick (F0 ~ 0,03 : eau sombre, métal 0,6 du JS)
	vec3 nrm = normalize(NORMAL + (TANGENT * n.x + BINORMAL * n.y) * normal_depth);
	vec3 rw = (INV_VIEW_MATRIX * vec4(reflect(-VIEW, nrm), 0.0)).xyz;
	float fr = 0.03 + 0.97 * pow(1.0 - clamp(dot(nrm, VIEW), 0.0, 1.0), 5.0);
	EMISSION = env_sky(rw) * fr * (1.0 + metallic * 2.0);
}
