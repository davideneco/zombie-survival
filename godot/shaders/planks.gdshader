shader_type spatial;
render_mode cull_disabled;
// v0.32.2 : planches des portes barricadées et des fenêtres condamnées (dessin du JS : planches, clous) avec le bois PBR « wood_door » (Poly Haven CC0
// dark_planks) : fil, nœuds et rugosité réels, normale dans le repère des UV (planches horizontales) tiré des dérivées d'écran.
uniform sampler2D albedo_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D wood_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D wood_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec2 uv_scale = vec2(1.0);
uniform float wood_rep = 1.5;
void fragment() {
	vec2 uv = UV * uv_scale;
	vec2 wuv = uv * wood_rep;
	vec3 a = texture(wood_a, wuv).rgb * 2.0;
	vec4 m = texture(wood_m, wuv);
	ALBEDO = texture(albedo_tex, uv).rgb * mix(vec3(1.0), a, 0.55);
	ROUGHNESS = clamp(m.b * 0.85 + 0.1, 0.0, 1.0);
	AO = mix(1.0, m.a, 0.6);
	vec3 dp1 = dFdx(VERTEX);
	vec3 dp2 = dFdy(VERTEX);
	vec2 du1 = dFdx(wuv);
	vec2 du2 = dFdy(wuv);
	vec3 dp2perp = cross(dp2, NORMAL);
	vec3 dp1perp = cross(NORMAL, dp1);
	vec3 T = dp2perp * du1.x + dp1perp * du2.x;
	vec3 B = dp2perp * du1.y + dp1perp * du2.y;
	float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-8));
	vec2 nxy = (m.rg * 2.0 - 1.0) * 0.9;
	NORMAL = normalize(T * inv * nxy.x - B * inv * nxy.y + NORMAL * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
}
