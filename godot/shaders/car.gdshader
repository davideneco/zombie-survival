shader_type spatial;
#include "env_reflect.gdshaderinc"
// v0.32.4 : voitures garées (scenes/world/cars_view.gd) : un maillage, des parties repérées par l'alpha de la couleur de sommet (id / 8), la couleur de la
// peinture par instance (INSTANCE_CUSTOM). Peinture vernie (reflet du ciel par Fresnel), vitres teintées réfléchissantes, pneus, jantes, optiques ;
// poussière sur le bas de caisse et le toit (voitures abandonnées), sans bruit non filtré.

varying vec3 paint;
varying float part;
varying float vao;
varying vec3 lpos;

void vertex() {
	paint = INSTANCE_CUSTOM.rgb;
	part = COLOR.a * 8.0;
	vao = COLOR.g;
	lpos = VERTEX;
}

void fragment() {
	int id = int(part + 0.5);
	vec3 col = paint;
	float rough = 0.5;
	float metal = 0.0;
	float refl = 0.25;
	vec3 em = vec3(0.0);
	if (id == 1) {          // vitres
		col = vec3(0.025, 0.03, 0.035);
		rough = 0.06;
		metal = 0.0;
		refl = 1.6;
	} else if (id == 2) {   // pneus
		col = vec3(0.035);
		rough = 0.9;
		metal = 0.0;
		refl = 0.0;
	} else if (id == 3) {   // jantes, chromes
		col = vec3(0.55, 0.56, 0.58);
		rough = 0.3;
		metal = 0.9;
		refl = 0.8;
	} else if (id == 4) {   // phares
		col = vec3(0.42, 0.42, 0.40);
		rough = 0.1;
		metal = 0.0;
		refl = 1.0;
	} else if (id == 5) {   // feux arrière
		col = vec3(0.35, 0.02, 0.02);
		rough = 0.15;
		metal = 0.0;
		em = vec3(0.06, 0.0, 0.0);
	} else if (id == 6) {   // plastique noir (pare-chocs, calandre, rétroviseurs)
		col = vec3(0.05, 0.05, 0.055);
		rough = 0.65;
		metal = 0.0;
		refl = 0.15;
	} else if (id == 7) {   // passage de roue
		col = vec3(0.01);
		rough = 1.0;
		metal = 0.0;
		refl = 0.0;
	}
	// poussière : bas de caisse et surfaces horizontales (voitures abandonnées)
	if (id == 0 || id == 1) {
		vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
		float dust = smoothstep(0.5, 0.3, lpos.y) * 0.18 + smoothstep(0.75, 0.95, nw.y) * 0.08;
		col = mix(col, vec3(0.33, 0.30, 0.26), dust);
		rough = mix(rough, 0.85, dust);
		refl *= 1.0 - dust;
	}
	ALBEDO = col;
	SPECULAR = id == 0 ? 0.3 : 0.5;
	ROUGHNESS = rough;
	METALLIC = metal;
	AO = vao;
	if (refl > 0.0) {
		vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
		vec3 vd = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);
		vec3 rd = reflect(-vd, nw);
		float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(nw, vd), 0.0, 1.0), 5.0);
		em += min(env_sky(rd) * fr * refl * 2.0, vec3(0.03, 0.036, 0.045) * refl);
	}
	EMISSION = em;
}
