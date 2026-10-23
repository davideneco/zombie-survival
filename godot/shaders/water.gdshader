shader_type spatial;
render_mode cull_disabled;
#include "env_reflect.gdshaderinc"
// Eau de l'Ill (v0.22.1). Avant : MeshStandardMaterial de realworld.js (0x0f2a3c, rugosité 0,08, métal 0,6) avec la carte de normales du JS, une grille de sinusoïdes en
// diagonale répétée tous les 6 m, qui donnait un quadrillage net et un moiré en perspective. Maintenant : relief calculé par six trains de vagues de directions et de longueurs
// d'onde sans rapport (aucune texture, donc aucune répétition lisible), dont l'amplitude varie lentement dans l'espace ; les petites vagues s'estompent avec la distance
// (plus de moiré au loin : l'eau lointaine est lisse et ne fait que refléter le ciel). Reflets : ciel d'ambiance (env_reflect.gdshaderinc) par Fresnel de Schlick, plus la
// lueur de la lune par la lumière directionnelle (SPECULAR) sur des vagues douces (rugosité 0,14 : pas de points brillants qui scintillent).

uniform vec4 albedo : source_color = vec4(0.0588, 0.1647, 0.2353, 1.0);
uniform float roughness = 0.14;
uniform float metallic = 0.6;
uniform float normal_depth = 0.6;     // intensité du relief (1 = pente maximale des vagues ci-dessous)
uniform float layers = 2.0;           // 1 en qualité Rapide : trois trains de vagues au lieu de six
uniform float refl_gain = 2.2;      // le ciel d'ambiance du JS (0,16) est faible : l'eau noire le renvoie nettement plus qu'un sol mat
// v0.32.5 : reflet plan (Haute) : image de la ville vue par une caméra miroir (scenes/world/water_reflection.gd), lue à la position d'écran (miroir en x)
// et décalée par la pente des vagues ; elle remplace le ciel d'ambiance là où elle existe (alpha) : façades, ponts, fenêtres allumées, arbres, lampadaires.
uniform sampler2D refl_tex : source_color, filter_linear, repeat_disable;
uniform float refl_on = 0.0;
uniform float refl_k = 0.55;        // l'image est déjà passée par le mappage tonal : ramenée dans la plage de l'émission

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

// pente (dérivée de la hauteur) d'un train de vagues : direction d, longueur d'onde wl, pente max s, vitesse v (m/s), phase ph, modulation d'amplitude lente
vec2 wave(vec2 p, vec2 d, float wl, float s, float v, float ph, float fade) {
	float k = 6.2831853 / wl;
	float a = dot(p, d) * k - v * k * TIME + ph;
	float m = 0.65 + 0.35 * sin(dot(p, vec2(d.y, -d.x)) * 0.043 + ph * 1.7) * sin(dot(p, d) * 0.021 - ph);
	return d * (s * m * fade * cos(a));
}

void fragment() {
	if (CAMERA_POSITION_WORLD.y < wpos.y) {
		discard;   // v0.32.5 : la caméra miroir du reflet (sous l'eau) ne doit pas voir le dessous de l'eau
	}
	vec2 p = wpos.xz;
	float dist = length(VERTEX);   // VERTEX est en espace vue dans fragment() : distance à la caméra
	float f1 = 1.0 - smoothstep(60.0, 150.0, dist);
	float f2 = 1.0 - smoothstep(35.0, 95.0, dist);
	float f3 = 1.0 - smoothstep(18.0, 55.0, dist);
	vec2 g = wave(p, normalize(vec2(0.83, 0.56)), 4.7, 0.050, 0.55, 0.0, 1.0);
	g += wave(p, normalize(vec2(-0.42, 0.91)), 2.9, 0.045, 0.62, 1.3, f1);
	g += wave(p, normalize(vec2(0.97, -0.25)), 1.7, 0.040, 0.48, 2.1, f1);
	if (layers > 1.5) {
		g += wave(p, normalize(vec2(-0.74, -0.67)), 1.05, 0.032, 0.40, 0.7, f2);
		g += wave(p, normalize(vec2(0.10, 0.99)), 0.63, 0.026, 0.35, 3.3, f3);
		g += wave(p, normalize(vec2(0.61, -0.79)), 0.37, 0.020, 0.30, 4.6, f3);
	}
	g *= normal_depth / 0.6;
	vec3 nw = normalize(vec3(-g.x, 1.0, -g.y));
	vec3 nv = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
	NORMAL = nv;
	ALBEDO = albedo.rgb * 0.5;   // eau profonde : peu de diffusion (l'ambiance bleue la rendait d'un bleu uni de plastique)
	ROUGHNESS = roughness;
	METALLIC = 0.0;
	SPECULAR = 0.6;
	vec3 rw = (INV_VIEW_MATRIX * vec4(reflect(normalize(VERTEX), nv), 0.0)).xyz;
	rw.y = abs(rw.y);   // un reflet qui plongerait sous l'horizon (vagues rasantes) renvoie le ciel, pas le sol
	float fr = 0.03 + 0.97 * pow(1.0 - clamp(dot(nv, normalize(-VERTEX)), 0.0, 1.0), 5.0);
	vec3 sky = env_sky(rw) * (1.0 + metallic * 2.0) * refl_gain;
	if (refl_on > 0.5) {
		vec2 suv = vec2(1.0 - SCREEN_UV.x, SCREEN_UV.y) + vec2(-g.x, g.y) * 0.12 * (1.0 - smoothstep(20.0, 120.0, dist));
		vec4 r = texture(refl_tex, clamp(suv, vec2(0.001), vec2(0.999)));
		sky = mix(sky, r.rgb * r.rgb * refl_k, 0.9);   // (sRGB -> à peu près linéaire)
	}
	EMISSION = sky * fr;
}
