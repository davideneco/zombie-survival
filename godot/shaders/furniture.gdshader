shader_type spatial;
#include "env_reflect.gdshaderinc"
// v0.33.1 : mobilier urbain ajouté (scenes/world/furniture_view.gd) : une matière par partie, repérée par l'alpha de la couleur de sommet (id / 8) ;
// COLOR.g : occlusion peinte. INSTANCE_CUSTOM : r = variation de teinte, g = graine des affiches.
//   0 fonte peinte vert sombre (bancs, corbeilles, kiosques, colonnes)   1 bois (lattes)   2 acier galvanisé   3 verre de lanterne (allumé la nuit)
//   4 béton   5 affiches   6 anthracite   7 zinc / bande rouge et blanche (selon la hauteur)

uniform float night = 0.0;

varying float part;
varying float vao;
varying vec3 lpos;
varying vec2 icd;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void vertex() {
	part = COLOR.a * 8.0;
	vao = COLOR.g;
	lpos = VERTEX;
	icd = INSTANCE_CUSTOM.rg;
}

void fragment() {
	int id = int(part + 0.5);
	float tint = icd.x;
	vec3 col = vec3(0.12, 0.2, 0.15);
	float rough = 0.55;
	float metal = 0.3;
	float refl = 0.2;
	vec3 em = vec3(0.0);
	if (id == 0) {
		col = mix(vec3(0.09, 0.17, 0.13), vec3(0.13, 0.2, 0.17), tint);
	} else if (id == 1) {   // lattes de bois : veines le long de x, teinte par objet
		float g = sin(lpos.x * 37.0 + sin(lpos.y * 11.0 + lpos.z * 9.0) * 2.0) * 0.5 + 0.5;
		col = mix(vec3(0.33, 0.2, 0.11), vec3(0.45, 0.3, 0.17), g * 0.6 + tint * 0.4);
		rough = 0.78;
		metal = 0.0;
		refl = 0.05;
	} else if (id == 2) {
		col = vec3(0.56, 0.58, 0.6);
		rough = 0.42;
		metal = 0.85;
		refl = 0.6;
	} else if (id == 3) {   // verre de lanterne
		col = vec3(0.75, 0.72, 0.62);
		rough = 0.1;
		metal = 0.0;
		refl = 0.8;
		em = vec3(1.0, 0.78, 0.45) * night * 3.2;
	} else if (id == 4) {
		col = vec3(0.47, 0.46, 0.44);
		rough = 0.9;
		metal = 0.0;
		refl = 0.0;
	} else if (id == 5) {   // affiches : bandes et blocs de couleur, différentes pour chaque objet
		float a = atan(lpos.z, lpos.x);
		vec2 cell = floor(vec2(a * 1.3 + lpos.x * 0.8, lpos.y * 0.95 + floor(a * 1.3) * 0.37) + icd.y * 17.0);
		float h = hash(cell);
		vec3 c1 = vec3(0.78, 0.18, 0.12);
		vec3 c2 = vec3(0.92, 0.86, 0.7);
		vec3 c3 = vec3(0.15, 0.3, 0.55);
		vec3 c4 = vec3(0.95, 0.72, 0.15);
		col = h < 0.25 ? c1 : (h < 0.55 ? c2 : (h < 0.8 ? c3 : c4));
		float line = step(0.8, fract(lpos.y * 7.0 + h * 3.0)) * step(0.35, fract(a * 9.0 + h * 5.0)) * step(h, 0.7);   // lignes de texte
		col = mix(col, vec3(0.08), line * 0.6);
		col *= 0.82;
		rough = 0.85;
		metal = 0.0;
		refl = 0.05;
		em = col * night * 0.06;
	} else if (id == 6) {
		col = vec3(0.07, 0.075, 0.08);
		rough = 0.5;
		metal = 0.5;
		refl = 0.25;
	} else if (id == 7) {
		if (lpos.y < 1.5) {   // bande réfléchissante (bornes)
			col = step(0.5, fract(lpos.y * 12.5)) > 0.5 ? vec3(0.75, 0.07, 0.05) : vec3(0.85);
			rough = 0.35;
			metal = 0.0;
			refl = 0.4;
		} else {              // zinc des toits
			col = vec3(0.36, 0.39, 0.41);
			rough = 0.5;
			metal = 0.7;
			refl = 0.4;
		}
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metal;
	AO = vao;
	SPECULAR = 0.4;
	if (refl > 0.0) {
		vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
		vec3 vd = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);
		vec3 rd = reflect(-vd, nw);
		float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(nw, vd), 0.0, 1.0), 5.0);
		em += min(env_sky(rd) * fr * refl * 2.0, vec3(0.03, 0.036, 0.045) * refl);
	}
	EMISSION = em;
}
