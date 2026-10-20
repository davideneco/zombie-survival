shader_type spatial;
render_mode cull_disabled;
// Façades : matériau de src/architecture.js (carte de façade dessinée sur canevas + carte d'émission des fenêtres + couleur de sommet : pieds de murs assombris)
// avec la texture de détail fine (withDetail : plâtre en niveaux de gris multiplié 0,74 + 0,56 x détail, à 5 x 3,7 répétitions) qui casse l'aplat des murs.

uniform sampler2D albedo_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D emission_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D detail_tex : repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec4 albedo : source_color = vec4(1.0);
uniform vec3 emission_color : source_color = vec3(1.0, 0.82, 0.45);
uniform float emission_energy = 0.55;
uniform float roughness = 0.9;
uniform float metallic = 0.0;
uniform vec2 uv_scale = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform vec2 detail_repeat = vec2(5.0, 3.7);
uniform float glow_k = 0.0;          // v0.22.4 : halo des fenêtres allumées sur le mur (0 : aucun)
uniform float glow_lod = 3.5;
uniform float detail_k = 1.0;        // 0 : sans détail (qualité Rapide)

void fragment() {
	vec2 uv = UV * uv_scale + uv_offset;
	vec3 col = texture(albedo_tex, uv).rgb * albedo.rgb * COLOR.rgb;
	col *= mix(1.0, 0.74 + 0.56 * texture(detail_tex, uv * detail_repeat).r, detail_k);
	ALBEDO = col;
	ROUGHNESS = roughness;
	METALLIC = metallic;
	vec3 em = texture(emission_tex, uv).rgb;
	// halo : la même carte lue en niveau de détail grossier (flou) : la lueur des fenêtres déborde sur le mur autour, comme un bloom, sans passe d'écran ni bruit
	if (glow_k > 0.0) {
		em += textureLod(emission_tex, uv, glow_lod).rgb * glow_k;
	}
	EMISSION = emission_color * em * emission_energy;
}
