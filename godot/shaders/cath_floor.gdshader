shader_type spatial;
// v0.32.1 : dallage de la cathédrale (remplace le damier rouge et blanc du JS) : dalles de grès gris-rose en appareil décalé (1,2 x 0,8 m), teinte et usure
// propres à chaque dalle, joints sombres, poli au centre des allées (reflets doux), détail PBR (Poly Haven CC0) ; aucune texture sans mipmaps ni bruit.
uniform sampler2D stone_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D stone_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 axis_u = vec3(0.869, 0.0, -0.494);   // axe de la nef (s) : les dalles suivent la nef
uniform vec3 origin = vec3(179.14, 0.0, 39.53);
varying vec3 wpos;
void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
float h21(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
void fragment() {
	vec3 d = wpos - origin;
	vec3 av = vec3(-axis_u.z, 0.0, axis_u.x);
	vec2 st = vec2(dot(d, axis_u), dot(d, av));
	vec2 g = vec2(st.x / 1.2, st.y / 0.8);
	float row = floor(g.y);
	g.x += mod(row, 2.0) * 0.5;
	vec2 cell = floor(g);
	vec2 f = fract(g);
	float h = h21(cell);
	float h2 = h21(cell + 17.3);
	vec2 e = min(f, 1.0 - f) * vec2(1.2, 0.8);
	float joint = 1.0 - smoothstep(0.004, 0.018, min(e.x, e.y));
	vec3 base = mix(vec3(0.44, 0.40, 0.37), vec3(0.50, 0.39, 0.35), h);
	base *= 0.86 + 0.22 * h2;
	vec2 uv = st / 3.4 + cell * 0.37;   // grande échelle : le motif de blocs de la texture ne doit pas se lire comme des joints
	vec3 a = texture(stone_a, uv).rgb * 2.0;
	vec4 m = texture(stone_m, uv);
	vec3 col = base * mix(vec3(1.0), a, 0.3);
	// allée centrale : polie par le passage
	float aisle = 1.0 - smoothstep(2.5, 6.5, abs(st.y));
	col = mix(col, col * 0.4, joint);
	ALBEDO = col;
	ROUGHNESS = mix(clamp(m.b * 0.7 + 0.3, 0.0, 1.0), 0.28, aisle * 0.7) + joint * 0.3;
	SPECULAR = 0.35;
	AO = mix(1.0, m.a, 0.5);
	vec2 nxy = (m.rg * 2.0 - 1.0) * 0.5;
	vec3 nw = normalize(vec3(nxy.x, 1.0, nxy.y));
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
}
