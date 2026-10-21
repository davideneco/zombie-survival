shader_type spatial;
render_mode cull_disabled;
// v0.24.4 : toits. Le JS dessine déjà un motif de tuiles (albedo_tex, teinte par sommet = couleur du toit selon le matériau OSM). On y multiplie le détail PBR (Poly Haven CC0
// clay_roof_tiles_02 : tuiles à l'échelle réelle, recouvrement, mousse) et on remplace la normale / rugosité / occlusion par les siennes. Repère de normale : cotangent construit
// des dérivées écran (le maillage cuit n'a pas de tangentes). Aucune texture sans mipmaps ni bruit.

uniform sampler2D albedo_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D pbr_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D pbr_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform float pbr_k = 1.0;
uniform float pbr_scale = 0.85;     // répétitions par unité d'UV du JS (1 unité = 3 m environ)
uniform float amt = 0.75;
uniform float normal_k = 0.9;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 col = texture(albedo_tex, UV).rgb * COLOR.rgb;
	float rough = 0.85;
	float ao = 1.0;
	if (pbr_k > 0.5) {
		vec2 uv = UV * pbr_scale;
		vec3 a = mix(vec3(1.0), texture(pbr_a, uv).rgb * 2.0, amt);
		vec4 m = texture(pbr_m, uv);
		col *= a;
		rough = mix(0.85, m.b, 0.8);
		ao = mix(1.0, m.a, 0.5);
		// repère tangent d'après les dérivées de la position écran et des UV
		vec3 dp1 = dFdx(VERTEX);
		vec3 dp2 = dFdy(VERTEX);
		vec2 du1 = dFdx(uv);
		vec2 du2 = dFdy(uv);
		vec3 dp2perp = cross(dp2, NORMAL);
		vec3 dp1perp = cross(NORMAL, dp1);
		vec3 T = dp2perp * du1.x + dp1perp * du2.x;
		vec3 B = dp2perp * du1.y + dp1perp * du2.y;
		float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-8));
		T *= inv;
		B *= inv;
		vec2 nxy = (m.rg * 2.0 - 1.0) * normal_k;
		vec3 n = normalize(T * nxy.x - B * nxy.y + NORMAL * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
		NORMAL = FRONT_FACING ? n : -n;
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	AO = ao;
	AO_LIGHT_AFFECT = 0.6;
}
