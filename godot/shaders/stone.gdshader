shader_type spatial;
render_mode cull_back;
// v0.24.2 : pierre de la cathédrale (grès rose des Vosges, patine) pour les maillages procéduraux de scenes/world/cathedral_view.gd.
// Cartographie plane par axe dominant en mètres du monde (grand appareil Poly Haven CC0 : large_sandstone_blocks_01), teinte du grès, coulures de pluie et suie au pied,
// occlusion peinte dans la couleur de sommet (COLOR.r), projecteurs de nuit simulés (lavis chaud qui monte le long de la façade : aucune lumière en plus, aucun bruit non filtré).

uniform sampler2D stone_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D stone_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 tint : source_color = vec3(0.62, 0.43, 0.34);
uniform float scale = 2.8;            // m par répétition
uniform float night = 1.0;            // 1 : nuit (projecteurs allumés), 0 : jour
uniform vec3 flood_color : source_color = vec3(1.0, 0.70, 0.40);
uniform vec3 flood_dir = vec3(-0.869, 0.0, 0.494);   // sens vers lequel la façade fait face (vers l'extérieur) ; réglé par cathedral_view.gd
uniform float flood_energy = 0.55;
uniform float flood_height = 46.0;    // m : le lavis s'éteint avec la hauteur
uniform float normal_k = 0.9;

varying vec3 wpos;
varying vec3 wnrm;
varying float vao;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize(MODEL_NORMAL_MATRIX * NORMAL);
	vao = COLOR.r;
}

void fragment() {
	vec3 N = normalize(wnrm);
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
	// patine : coulures verticales (échelle large, même texture), suie et humidité au pied, mousse dans les creux
	float streak = texture(stone_m, vec2((wpos.x + wpos.z) * 0.19, wpos.y * 0.035)).a;
	float soot = smoothstep(14.0, 0.0, wpos.y);
	vec3 col = tint * a;
	col *= mix(1.0, 0.62 + 0.55 * streak, 0.7);
	col *= 1.0 - soot * 0.35;
	col = mix(col, col * vec3(0.78, 0.9, 0.62), (1.0 - vao) * 0.5);   // vert-de-gris dans les creux
	ALBEDO = col;
	ROUGHNESS = clamp(m.b * 0.9 + 0.1, 0.0, 1.0);
	AO = mix(1.0, vao, 0.9);
	AO_LIGHT_AFFECT = 0.7;
	vec2 nxy = (m.rg * 2.0 - 1.0) * normal_k;
	vec3 nw = normalize(T * nxy.x + B * nxy.y * ((an.y > max(an.x, an.z)) ? 1.0 : -1.0) + N * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
	// projecteurs : lavis chaud sur les faces tournées vers l'extérieur, de moins en moins haut
	float face = clamp(dot(N, normalize(flood_dir)) * 0.8 + 0.2, 0.0, 1.0);
	float wash = face * (1.0 - smoothstep(flood_height * 0.15, flood_height, wpos.y)) * vao;
	EMISSION = col * flood_color * wash * flood_energy * night;
}
