shader_type spatial;
render_mode cull_disabled;
#include "env_reflect.gdshaderinc"
// Façades : matériau de src/architecture.js (carte de façade dessinée sur canevas + carte d'émission des fenêtres + couleur de sommet : pieds de murs assombris)
// avec la texture de détail fine (withDetail : plâtre en niveaux de gris multiplié 0,74 + 0,56 x détail, à 5 x 3,7 répétitions) qui casse l'aplat des murs.
//
// v0.24.1 (pbr_k > 0, Normale et Haute) : matériaux PBR réalistes (Poly Haven CC0, godot/assets/pbr/) et relief. La carte de BOSSES dessinée par le JS (encadrements,
// appuis, vitres en retrait, poutres : jamais exportée avant v0.24.1) sert de hauteur : elle donne (1) trois masques (mur, saillie, vitre), (2) une normale de relief
// (Image.bump_map_to_normal_map au chargement), (3) une occlusion de cavité (bosse floue moins bosse : les creux foncent). Le mur reçoit le détail du PBR à l'échelle
// réelle (cartographie plane en mètres du monde : wall_scale m par répétition, décalée par bâtiment) : le détail est MULTIPLIÉ à la couleur dessinée (palette,
// coulures, jardinières gardées), sa normale et sa rugosité remplacent celles du mur ; les saillies prennent le bois (colombages) ou la pierre ; les vitres sont
// lisses et reflètent le ciel (Fresnel, env_reflect). Variation par bâtiment : teinte, usure, humidité au pied (noise de la texture PBR elle-même, sans bruit en plus).

uniform sampler2D albedo_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D emission_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D detail_tex : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D bump_tex : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;      // R : relief dessiné (0,5 mur, > 0,7 saillie, < 0,25 vitre)
uniform sampler2D relief_tex : hint_normal, repeat_enable, filter_linear_mipmap_anisotropic;           // normale issue de bump_tex
uniform sampler2D wall_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;               // détail multiplicatif du mur (moyenne 0,5 par canal)
uniform sampler2D wall_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;         // RG normale, B rugosité, A occlusion
uniform sampler2D wood_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;               // bois des colombages
uniform sampler2D wood_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
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
uniform float pbr_k = 0.0;           // v0.24.1 : 0 : ancien rendu (Rapide) ; 1 : PBR + relief
uniform float pbr_hi = 0.0;          // Haute : bois PBR des colombages, reflets plus nets
uniform float wall_scale = 2.0;      // m par répétition du PBR du mur
uniform float wall_amt = 0.8;        // part du détail PBR appliquée à la couleur dessinée
uniform float wood_scale = 1.8;
uniform float trim_wood = 0.0;       // 1 : les saillies sont du bois (colombages)
uniform float relief_k = 1.0;        // force de la normale de relief
uniform float glass_k = 1.0;         // reflet des vitres

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize(MODEL_NORMAL_MATRIX * NORMAL);
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void fragment() {
	vec2 uv = UV * uv_scale + uv_offset;
	vec3 col = texture(albedo_tex, uv).rgb * albedo.rgb * COLOR.rgb;
	float rough = roughness;
	float ao = 1.0;
	float glass = 0.0;
	vec3 sky_refl = vec3(0.0);
	if (pbr_k > 0.5) {
		float side = FRONT_FACING ? 1.0 : -1.0;
		vec3 N = normalize(wnrm) * side;
		float b = texture(bump_tex, uv).r;
		float wall = smoothstep(0.30, 0.38, b) * (1.0 - smoothstep(0.62, 0.72, b));
		float trim = smoothstep(0.62, 0.72, b);
		glass = 1.0 - smoothstep(0.20, 0.30, b);
		// repère du mur : T horizontal le long de la façade, haut = +y ; s : sens de T par rapport à l'axe u de la texture
		vec3 T = normalize(vec3(-N.z, 0.0, N.x) + vec3(1e-4, 0.0, 0.0));
		vec3 up = vec3(0.0, 1.0, 0.0);
		float s = (dot(dFdx(wpos), T) * dFdx(uv.x) + dot(dFdy(wpos), T) * dFdy(uv.x)) >= 0.0 ? 1.0 : -1.0;
		// bâtiment : maille de 14 m (teinte, décalage du motif, usure)
		vec2 cell = floor(wpos.xz / 14.0);
		float h1 = hash12(cell);
		float h2 = hash12(cell + 17.0);
		vec2 wuv = vec2(dot(wpos, T) + h1 * 53.0, -wpos.y + h2 * 41.0) / wall_scale;
		vec3 wa = mix(vec3(1.0), texture(wall_a, wuv).rgb * 2.0, 0.6);
		vec4 wm = texture(wall_m, wuv);
		float wear = 0.55 + 0.9 * h2;                                   // usure propre au bâtiment
		float damp = smoothstep(1.6, 0.0, wpos.y);                       // humidité qui remonte au pied
		col *= mix(vec3(1.0), wa, wall * wall_amt * wear);
		col *= 1.0 + (h1 - 0.5) * 0.14;
		col *= 1.0 - damp * (1.0 - wm.a) * 0.9 * wall;
		vec2 nxy = (wm.rg * 2.0 - 1.0) * wall * 0.9;
		rough = mix(roughness, mix(wm.b, 1.0, 0.15), wall);
		float aoo = mix(1.0, wm.a, wall * 0.4);
		if (trim_wood > 0.5 && pbr_hi > 0.5) {
			vec2 tuv = vec2(dot(wpos, T), -wpos.y) / wood_scale;
			vec3 ta = texture(wood_a, tuv).rgb * 2.0;
			vec4 tm = texture(wood_m, tuv);
			col *= mix(vec3(1.0), mix(vec3(1.0), ta, 0.5), trim);   // fil du bois non orienté (poutres dans les deux sens) : amplitude réduite
			nxy += (tm.rg * 2.0 - 1.0) * trim * 0.7;
			rough = mix(rough, tm.b, trim);
		} else if (trim > 0.01) {
			col *= mix(vec3(1.0), wa, trim * 0.5);                          // encadrements : même pierre
			rough = mix(rough, 0.82, trim);
		}
		// relief dessiné (normale issue des bosses) : repère de la texture
		vec2 rn = (texture(relief_tex, uv).rg * 2.0 - 1.0) * relief_k;
		nxy += vec2(rn.x * s, rn.y);
		float cav = textureLod(bump_tex, uv, 2.0).r - b;                    // creux : plus foncé
		aoo *= 1.0 - clamp(cav * 2.2, 0.0, 0.55);
		ao = aoo;
		// vitre : lisse et sombre (reflet du ciel plus bas)
		rough = mix(rough, 0.07, glass);
		vec3 nw = normalize(T * nxy.x + up * nxy.y + N * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
		NORMAL = normalize((VIEW_MATRIX * vec4(nw * side, 0.0)).xyz);
		if (glass > 0.01 && glass_k > 0.0) {
			vec3 vdir = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);   // du point vers la caméra
			vec3 rd = reflect(-vdir, nw * side);
			float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(nw * side, vdir), 0.0, 1.0), 5.0);
			vec3 sk = env_sky(rd);
			sky_refl = mix(vec3(dot(sk, vec3(0.33))), sk, 0.5) * fr * glass * glass_k * 3.0;
		}
	} else {
		col *= mix(1.0, 0.74 + 0.56 * texture(detail_tex, uv * detail_repeat).r, detail_k);
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metallic;
	AO = ao;
	AO_LIGHT_AFFECT = 0.5;
	vec3 em = texture(emission_tex, uv).rgb;
	// halo : la même carte lue en niveau de détail grossier (flou) : la lueur des fenêtres déborde sur le mur autour, comme un bloom, sans passe d'écran ni bruit
	if (glow_k > 0.0) {
		em += textureLod(emission_tex, uv, glow_lod).rgb * glow_k;
	}
	EMISSION = emission_color * em * emission_energy + sky_refl;
}
