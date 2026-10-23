shader_type spatial;
render_mode cull_disabled;   // volets en miroir (échelle négative) et gouttières ouvertes vues des deux côtés
// v0.32.2 : détails 3D des façades et des toits (scenes/world/city_details_view.gd, MultiMesh) : encadrements de pierre, volets persiennés, ferronnerie,
// zinc des gouttières, brique des cheminées, faîtières. Détail PBR (Poly Haven CC0, godot/assets/pbr) en projection triplanaire en mètres du monde ;
// la teinte vient de la couleur d'instance (volets, encadrements) ou de `tint`. Aucun bruit non filtré.

uniform int kind = 0;                 // 0 pierre, 1 volet, 2 fer, 3 zinc, 4 brique, 5 jardinière (couleurs de sommet), 6 faîtière
uniform sampler2D det_a : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D det_m : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform vec3 tint : source_color = vec3(1.0);
uniform float det_scale = 1.6;
uniform float det_amt = 0.6;
uniform float use_instance = 1.0;

varying vec3 wpos;
varying vec3 wnrm;
varying vec3 lpos;
varying vec4 icol;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	lpos = VERTEX;
	icol = COLOR;
}

void fragment() {
	vec3 N = normalize(wnrm);
	vec3 an = abs(N);
	vec2 uv = an.y > max(an.x, an.z) ? wpos.xz : (an.x > an.z ? vec2(wpos.z, wpos.y) : vec2(wpos.x, wpos.y));
	uv /= det_scale;
	vec3 a = texture(det_a, uv).rgb * 2.0;
	vec4 m = texture(det_m, uv);
	vec3 base = tint;
	if (use_instance > 0.5) {
		base *= icol.rgb;
	}
	float rough = clamp(m.b * 0.8 + 0.15, 0.0, 1.0);
	float metal = 0.0;
	float slat = 0.0;
	if (kind == 1) {
		// persiennes : lames inclinées tous les 7 cm (le local y est la hauteur du volet)
		float f = fract(lpos.y / 0.07);
		slat = smoothstep(0.0, 0.15, f) * (1.0 - smoothstep(0.75, 1.0, f));
		base *= 0.72 + 0.28 * slat;
		rough = 0.55;
	} else if (kind == 2) {
		base = vec3(0.06, 0.06, 0.065);
		rough = 0.45;
		metal = 0.6;
	} else if (kind == 3) {
		base = vec3(0.52, 0.54, 0.55) * mix(vec3(1.0), a, 0.25);
		rough = 0.42;
		metal = 0.75;
	} else if (kind == 5) {
		base = icol.rgb;
		rough = 0.8;
	}
	vec3 col = kind == 2 || kind == 3 || kind == 5 ? base : base * mix(vec3(1.0), a, det_amt);
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metal;
	AO = mix(1.0, m.a, 0.5);
	if (kind == 0 || kind == 4 || kind == 6) {
		vec2 nxy = (m.rg * 2.0 - 1.0) * 0.7;
		vec3 T = an.y > max(an.x, an.z) ? vec3(1.0, 0.0, 0.0) : (an.x > an.z ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
		vec3 B = an.y > max(an.x, an.z) ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
		vec3 nw = normalize(T * nxy.x + B * nxy.y + N * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
		NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
	}
}
