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
// v0.32.3 : pelouses et pieds d'arbres. grass_mask (1 m par texel, même emprise que sdf_tex) : R = densité d'arbres (pelouses des places et jardins),
// G = fosse de l'arbre (terre et feuilles mortes). Herbe PBR (Poly Haven CC0 leafy_grass) en projection en mètres, teinte et touffes variées par le bruit.
uniform sampler2D grass_mask : filter_linear, repeat_disable;
uniform sampler2D grass_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D grass_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform float grass_on = 0.0;
uniform vec3 grass_tint : source_color = vec3(0.21, 0.27, 0.12);
uniform vec3 soil_tint : source_color = vec3(0.24, 0.18, 0.12);

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
	// v0.32.3 : pelouses et fosses des arbres (pas contre les façades ni sur les trottoirs)
	float lawn = 0.0;
	float pit = 0.0;
	vec3 gn = vec3(0.0, 0.0, 1.0);
	if (grass_on > 0.5 && inside && quality > 0.5) {   // Rapide : pas de pelouses (coût : ~0,7 ms Intel)
		vec2 gm = texture(grass_mask, suv).rg;
		float away = smoothstep(apron_total + 0.4, apron_total + 2.2, sd);
		lawn = smoothstep(0.42, 0.62, gm.r + (nM - 0.5) * 0.35 + (nF - 0.5) * 0.12) * away;
		pit = smoothstep(0.35, 0.7, gm.g) * (1.0 - lawn);
		vec2 guv = gp / 1.7;
		vec3 ga = texture(grass_a, guv).rgb * 2.0;
		vec4 gmm = texture(grass_m, guv);
		vec3 gcol = grass_tint * ga * (0.82 + 0.36 * nL) * mix(vec3(1.0), vec3(1.12, 1.05, 0.7), smoothstep(0.55, 0.8, nF));   // plaques jaunies
		vec3 scol = soil_tint * mix(vec3(1.0), ga.ggg * 0.8, 0.4) * (0.8 + 0.4 * nG);
		col = mix(col, gcol, lawn);
		col = mix(col, scol, pit);
		gn = vec3(gmm.rg * 2.0 - 1.0, 1.0);
		pd *= 1.0 - max(lawn, pit);
		wet *= 1.0 - max(lawn, pit);
	}
	ALBEDO = col;
	float r = texture(rough_tex, uv).g * roughness_k;
	r = mix(r, 0.92, max(lawn, pit));
	r = mix(r, r * 0.72, wet);
	ROUGHNESS = mix(r, 0.045, pd);
	NORMAL_MAP = mix(texture(normal_tex, uv).xyz, gn * 0.5 + 0.5, max(lawn, pit));
	NORMAL_MAP_DEPTH = normal_depth * (1.0 - pd);
	SPECULAR = 0.5 * (1.0 - pd) * (1.0 - 0.6 * max(lawn, pit));
	METALLIC = 0.0;
	// flaques : reflet du ciel d'ambiance x puddle.reflect (3,5 dans le JS), Fresnel de Schlick
	if (pd > 0.001) {
		vec3 rw = (INV_VIEW_MATRIX * vec4(reflect(-VIEW, NORMAL), 0.0)).xyz;
		float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 5.0);
		EMISSION = min(env_sky(rw) * fr * puddle.z, vec3(0.10, 0.12, 0.15)) * pd;   // v0.32.3 : plafonné (ciel de jour : flaques sombres qui reflètent, pas blanches)
	}
}
