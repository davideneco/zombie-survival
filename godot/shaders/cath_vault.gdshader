shader_type spatial;
render_mode cull_disabled;
// v0.32.1 : plafonds plats de l'intérieur de la cathédrale cuits du JS (voûte peinte : ciel bleu étoilé et nervures) : le fond devient un enduit de pierre
// clair (grès, détail PBR), les nervures et la clé gardent leur dessin en pierre plus sombre ; plus d'étoiles.
uniform sampler2D albedo_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D stone_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D stone_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 web : source_color = vec3(0.80, 0.70, 0.58);
uniform vec3 rib : source_color = vec3(0.56, 0.40, 0.33);
varying vec3 wpos;
void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
void fragment() {
	vec3 c = texture(albedo_tex, UV).rgb;
	float blue = smoothstep(0.02, 0.12, c.b - max(c.r, c.g));      // fond bleu (et étoiles dorées sur fond bleu : petites, absorbées par le flou des mipmaps)
	float star = smoothstep(0.1, 0.3, c.r - c.b) * blue;
	vec2 uv = wpos.xz / 2.4;
	vec3 d = texture(stone_a, uv).rgb * 2.0;
	vec4 m = texture(stone_m, uv);
	vec3 col = mix(rib, web, max(blue, star)) * mix(vec3(1.0), d, 0.5);
	ALBEDO = col;
	ROUGHNESS = clamp(m.b * 0.6 + 0.35, 0.0, 1.0);
	AO = mix(1.0, m.a, 0.5);
}
