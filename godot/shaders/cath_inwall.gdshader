shader_type spatial;
render_mode cull_disabled;
// v0.32.0 : murs intérieurs de la cathédrale cuits du JS (vitraux peints, émission la nuit) : leur face intérieure garde la texture du JS ; leur face extérieure, qui
// se voyait de la rue là où le contour OSM manquait (chevet, croisée, octogone de la tour), devient de la pierre (même grès que scenes/world/cathedral_*.gd).

uniform sampler2D albedo_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D emis_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 emis_color : source_color = vec3(1.0);
uniform float emis_energy = 1.1;
uniform float roughness = 0.85;
uniform float flip = 0.0;              // 1 : l'intérieur est la face arrière
uniform sampler2D stone_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D stone_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 tint : source_color = vec3(0.62, 0.43, 0.34);
uniform float scale = 2.8;
uniform float night = 0.0;             // projecteurs (comme shaders/stone.gdshader) sur la face extérieure
uniform vec3 flood_color : source_color = vec3(1.0, 0.80, 0.58);
uniform float flood_energy = 0.7;

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize(MODEL_NORMAL_MATRIX * NORMAL);
}

void fragment() {
	bool inner = FRONT_FACING != (flip > 0.5);
	if (inner) {
		// v0.32.1 : hors des vitraux (émission faible), le mur peint prend le détail et le relief du grès (projection plane en mètres)
		vec3 e = texture(emis_tex, UV).rgb;
		float glassm = smoothstep(0.08, 0.25, max(e.r, max(e.g, e.b)));
		vec3 Ni = FRONT_FACING ? normalize(wnrm) : -normalize(wnrm);
		vec3 Ti = normalize(cross(vec3(0.0, 1.0, 0.0), Ni) + vec3(1e-4, 0.0, 0.0));
		vec2 uvi = vec2(dot(wpos, Ti), -wpos.y) / scale;
		vec3 sa = texture(stone_a, uvi).rgb * 2.0;
		vec4 sm = texture(stone_m, uvi);
		ALBEDO = texture(albedo_tex, UV).rgb * mix(mix(vec3(1.0), sa, 0.55), vec3(1.0), glassm);
		ROUGHNESS = mix(clamp(sm.b * 0.9 + 0.1, 0.0, 1.0), roughness, glassm);
		AO = mix(mix(1.0, sm.a, 0.6), 1.0, glassm);
		vec2 nxy = (sm.rg * 2.0 - 1.0) * 0.8 * (1.0 - glassm);
		vec3 nwi = normalize(Ti * nxy.x - vec3(0.0, 1.0, 0.0) * nxy.y + Ni * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
		NORMAL = normalize((VIEW_MATRIX * vec4(nwi, 0.0)).xyz);
		EMISSION = emis_color * e * emis_energy;
	} else {
		vec3 N = FRONT_FACING ? normalize(wnrm) : -normalize(wnrm);
		vec3 an = abs(N);
		vec2 uv;
		vec3 T;
		vec3 B;
		if (an.y > max(an.x, an.z)) {
			uv = wpos.xz;
			T = vec3(1.0, 0.0, 0.0);
			B = vec3(0.0, 0.0, 1.0);
		} else if (an.x > an.z) {
			uv = vec2(wpos.z, -wpos.y);
			T = vec3(0.0, 0.0, 1.0);
			B = vec3(0.0, 1.0, 0.0);
		} else {
			uv = vec2(wpos.x, -wpos.y);
			T = vec3(1.0, 0.0, 0.0);
			B = vec3(0.0, 1.0, 0.0);
		}
		uv /= scale;
		vec3 a = mix(vec3(1.0), texture(stone_a, uv).rgb * 2.0, 0.85);
		vec4 m = texture(stone_m, uv);
		float streak = texture(stone_m, vec2((wpos.x + wpos.z) * 0.19, wpos.y * 0.035)).a;
		vec3 col = tint * a * mix(1.0, 0.62 + 0.55 * streak, 0.7);
		ALBEDO = col;
		ROUGHNESS = clamp(m.b * 0.9 + 0.1, 0.0, 1.0);
		AO = mix(1.0, m.a, 0.6);
		vec2 nxy = (m.rg * 2.0 - 1.0) * 0.9;
		vec3 nw = normalize(T * nxy.x + B * nxy.y * ((an.y > max(an.x, an.z)) ? 1.0 : -1.0) + N * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
		NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
		float wash = (0.55 - 0.25 * max(N.y, 0.0)) * (1.0 - smoothstep(18.0, 120.0, wpos.y));
		EMISSION = col * flood_color * wash * flood_energy * night;
	}
}
