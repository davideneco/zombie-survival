// v0.34.0 : matériau des surfaces de la Station des Aiguilles (scenes/world/alpine_view.gd). Maillages sans UV (GeoBuilder : normales plates,
// COLOR.r = occlusion peinte) : projection planaire en coordonnées du monde selon l'axe dominant de la normale, détail d'albédo et normale /
// rugosité / AO des textures PBR du port (godot/assets/pbr/<nom>/a.png, m.png : tools/pack-pbr.py), teinte dessinée. Neige : les faces tournées
// vers le haut (toits, rebords, sol, branches) se couvrent de neige (texture snow_02), en plaques si snow_patch > 0. emit : fenêtres éclairées.
shader_type spatial;
render_mode cull_back, depth_draw_opaque;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D mat_tex : filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D snow_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D snow_mat : filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform vec3 tint : source_color = vec3(1.0);
uniform float scale = 0.5;          // répétitions par mètre
uniform float use_tex = 1.0;        // 0 : couleur unie (feuillage, métal)
uniform float use_snow_tex = 1.0;
uniform float snow = 1.0;           // neige sur les faces horizontales
uniform float snow_side = 0.0;      // poudrage des faces verticales (tempête)
uniform float snow_patch = 0.0;     // 0 : couverture uniforme, 1 : plaques (chemins, route)
uniform float snow_lo = 0.45;       // pente (normale.y) où la neige commence à tenir
uniform float normal_k = 1.0;
uniform float rough_mul = 1.0;
uniform float metal = 0.0;
uniform vec3 emit_color : source_color = vec3(0.0);
uniform float emit = 0.0;

varying vec3 w_pos;
varying vec3 w_nrm;

void vertex() {
	w_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	w_nrm = normalize(mat3(MODEL_MATRIX) * NORMAL);
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

void fragment() {
	vec3 n = normalize(w_nrm);
	vec3 a = abs(n);
	vec2 uv;
	vec3 T;
	vec3 B;
	if (a.y >= a.x && a.y >= a.z) {
		uv = w_pos.xz; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0);
	} else if (a.x >= a.z) {
		uv = vec2(w_pos.z, -w_pos.y); T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, -1.0, 0.0);
	} else {
		uv = vec2(w_pos.x, -w_pos.y); T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, -1.0, 0.0);
	}
	vec2 tuv = uv * scale;
	vec3 alb = mix(vec3(1.0), texture(albedo_tex, tuv).rgb * 2.0, use_tex) * tint;
	vec4 m = mix(vec4(0.5, 0.5, 0.75, 1.0), texture(mat_tex, tuv), use_tex);
	vec2 nxy = (m.rg * 2.0 - 1.0) * normal_k * use_tex;
	vec3 pn = normalize(T * nxy.x + B * nxy.y + n * sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
	// neige : faces tournées vers le haut, plaques de bruit, congères au pied des pentes
	float big = vnoise(w_pos.xz * 0.11) * 0.65 + vnoise(w_pos.xz * 0.43) * 0.35;
	float cover = snow * smoothstep(snow_lo, snow_lo + 0.3, pn.y);
	cover *= mix(1.0, smoothstep(0.35, 0.62, big), snow_patch);
	cover += snow_side * smoothstep(0.25, 0.85, vnoise(w_pos.xz * 1.7 + w_pos.y * 2.3)) * (1.0 - a.y) * 0.55;
	cover = clamp(cover, 0.0, 1.0);
	vec2 suv = (a.y > 0.5 ? w_pos.xz : uv) * 0.32;
	vec3 salb = mix(vec3(1.0), texture(snow_tex, suv).rgb * 2.0, use_snow_tex) * vec3(0.9, 0.93, 0.98);
	vec4 sm = mix(vec4(0.5, 0.5, 0.7, 1.0), texture(snow_mat, suv), use_snow_tex);
	vec2 sxy = (sm.rg * 2.0 - 1.0) * 0.6;
	vec3 sn = normalize(T * sxy.x + B * sxy.y + n * sqrt(max(0.0, 1.0 - dot(sxy, sxy))));
	vec3 wn = normalize(mix(pn, sn, cover));
	ALBEDO = mix(alb, salb, cover) * mix(COLOR.r, 1.0, cover * 0.6);
	ROUGHNESS = clamp(mix(m.b * rough_mul, sm.b * 0.9, cover), 0.04, 1.0);
	METALLIC = metal * (1.0 - cover);
	AO = mix(m.a, sm.a, cover);
	AO_LIGHT_AFFECT = 0.4;
	NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
	EMISSION = emit_color * emit;
}
