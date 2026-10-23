shader_type spatial;
render_mode cull_disabled;
// v0.32.0 : toitures de la cathédrale (maillages de scenes/world/cathedral_nave.gd et toits OSM de l'emprise de la cathédrale) : ardoise PBR (Poly Haven CC0
// roof_slates_02) en cuivre patiné / ardoise gris-vert, cartographiée en mètres le long de la pente (repère tangent tiré de la normale : aucun UV requis),
// coulures et lichen à bas bruit (mipmaps de la même texture), occlusion de sommet (COLOR.r) pour les noues et les pieds de lanterne.

uniform sampler2D slate_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D slate_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 tint : source_color = vec3(0.27, 0.31, 0.30);
uniform float scale = 2.2;            // m par répétition
uniform float normal_k = 0.9;
uniform float use_vc = 1.0;           // 0 : la couleur de sommet (toits cuits OSM) n'est pas une occlusion

varying vec3 wpos;
varying vec3 wnrm;
varying float vao;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize(MODEL_NORMAL_MATRIX * NORMAL);
	vao = mix(1.0, COLOR.r, use_vc);
}

void fragment() {
	vec3 N = normalize(wnrm);
	if (!FRONT_FACING) {
		N = -N;
	}
	// repère de la pente : T horizontal le long du faîtage, B vers le haut de la pente
	vec3 up = vec3(0.0, 1.0, 0.0);
	vec3 T = cross(up, N);
	if (dot(T, T) < 1e-4) {
		T = vec3(1.0, 0.0, 0.0);
	}
	T = normalize(T);
	vec3 B = normalize(cross(N, T));
	vec2 uv = vec2(dot(wpos, T), dot(wpos, B)) / scale;
	vec3 a = texture(slate_a, uv).rgb * 2.0;
	vec4 m = texture(slate_m, uv);
	float streak = texture(slate_m, vec2(dot(wpos, T) * 0.11, dot(wpos, B) * 0.02)).a;
	vec3 col = tint * mix(vec3(1.0), a, 0.8);
	col *= 0.78 + 0.32 * streak;
	col = mix(col, col * vec3(0.85, 1.0, 0.82), clamp(1.0 - vao, 0.0, 1.0) * 0.6);
	ALBEDO = col;
	ROUGHNESS = clamp(m.b * 0.8 + 0.15, 0.0, 1.0);
	METALLIC = 0.12;
	AO = mix(1.0, vao * m.a, 0.85);
	AO_LIGHT_AFFECT = 0.6;
	vec2 nxy = (m.rg * 2.0 - 1.0) * normal_k;
	vec3 nw = normalize(T * nxy.x + B * nxy.y + N * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
}
