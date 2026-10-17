shader_type spatial;
#include "env_reflect.gdshaderinc"
// Sol de pavés : port du shader de src/ground.js (onBeforeCompile du plan du sol). Le trottoir (dalles, bordure, caniveau) et les plaques d'égout sont des
// maillages à part, déjà cuits dans la carte ; ici : variation à grande échelle (teinte, rupture de la répétition des pavés), mousse au pied des murs,
// taches d'huile et de saleté, flaques (pavé sombre, lisse, qui réfléchit le ciel d'ambiance) à partir du champ de distance aux façades (ground_sdf.png).

uniform sampler2D albedo_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D normal_tex : hint_normal, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D rough_tex : hint_roughness_g, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D sdf_tex : filter_linear, repeat_disable;
uniform sampler2D noise_tex : repeat_enable, filter_linear_mipmap;
uniform vec4 albedo : source_color = vec4(1.0);
uniform float roughness_k = 1.0;
uniform float normal_depth = 1.2;
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 sdf_origin = vec2(-850.0, -590.0);
uniform vec2 sdf_size = vec2(1700.0, 1180.0);
uniform float sdf_min = -3.0;
uniform float sdf_range = 16.0;
uniform float apron_total = 1.51;     // apron + kerb + gutter : pas de flaque sur le trottoir
uniform vec4 puddle = vec4(0.66, 0.72, 3.5, 0.4);  // seuil bas, seuil haut, gain des reflets, assombrissement
uniform float quality = 1.0;          // 0 : sans flaques ni mousse (qualité Rapide)

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = UV * uv_scale;
	vec4 tex = texture(albedo_tex, uv);
	vec3 col = tex.rgb * albedo.rgb;
	vec2 gp = wpos.xz;
	vec2 suv = (gp - sdf_origin) / sdf_size;
	bool inside = suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0;
	float sd = inside ? texture(sdf_tex, suv).r * sdf_range + sdf_min : 99.0;
	// bruit : grandes taches (90 m), moyennes (23 m), fines (5,5 m), grain (1,3 m)
	float nL = texture(noise_tex, gp / 90.0).r;
	float nM = texture(noise_tex, gp / 23.0 + 0.37).g;
	float nF = texture(noise_tex, gp / 5.5 + 0.61).b;
	float nG = texture(noise_tex, gp / 1.3).a;
	// rupture de la répétition des pavés : luminosité d'une seconde échelle, désalignée
	float l2 = dot(texture(albedo_tex, uv * 0.31 + vec2(0.17, 0.43)).rgb, vec3(0.333));
	col *= 0.78 + 0.5 * clamp(l2 * 1.6, 0.0, 1.0) * 0.8;
	col *= vec3(0.80 + 0.40 * nL) * mix(vec3(0.96, 1.0, 1.06), vec3(1.07, 1.0, 0.92), smoothstep(0.3, 0.7, nM));
	float pd = 0.0;
	float wet = 0.0;
	if (quality > 0.5) {
		float near_wall = 1.0 - smoothstep(0.4, 4.0, sd);
		float moss = smoothstep(0.6, 0.8, nM * 0.6 + nF * 0.4) * near_wall * step(0.0, sd);
		col = mix(col, col * vec3(0.62, 0.8, 0.46) + vec3(0.01, 0.02, 0.0), moss * 0.7);
		float stain = smoothstep(0.7, 0.88, nF * 0.65 + nG * 0.35) * smoothstep(0.35, 0.6, nM);
		col *= 1.0 - 0.5 * stain;
		float pn = nL * 0.45 + nM * 0.4 + nF * 0.15;
		float open_g = smoothstep(apron_total, apron_total + 0.6, sd);
		pd = smoothstep(puddle.x, puddle.y, pn + (nG - 0.5) * 0.04) * open_g;
		wet = smoothstep(puddle.x - 0.07, puddle.y, pn) * open_g;
		col *= 1.0 - 0.28 * wet;
		col = mix(col, col * puddle.w, pd);
	}
	ALBEDO = col;
	float r = texture(rough_tex, uv).g * roughness_k;
	r = mix(r, r * 0.72, wet);
	ROUGHNESS = mix(r, 0.045, pd);
	NORMAL_MAP = texture(normal_tex, uv).xyz;
	NORMAL_MAP_DEPTH = normal_depth * (1.0 - pd);
	SPECULAR = 0.5 * (1.0 - pd);
	METALLIC = 0.0;
	// flaques : reflet du ciel d'ambiance x puddle.reflect (3,5 dans le JS), Fresnel de Schlick
	if (pd > 0.001) {
		vec3 rw = (INV_VIEW_MATRIX * vec4(reflect(-VIEW, NORMAL), 0.0)).xyz;
		float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 5.0);
		EMISSION = env_sky(rw) * fr * pd * puddle.z;
	}
}
