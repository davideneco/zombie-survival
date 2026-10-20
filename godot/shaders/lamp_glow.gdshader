shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
// Halos et flaques de lumière des lampadaires et des appliques (v0.22.2). Deux MultiMesh de quads (un appel de dessin chacun) : un halo qui regarde la caméra (le doux
// rayonnement autour d'une ampoule, qu'un bloom coûteux ferait) et une flaque horizontale sur le sol (la lumière des lampadaires lointains, qui n'en ont pas de vraie : seules
// les 8 sources les plus proches éclairent). Additif, sans ombre, couleur de la source en COLOR d'instance, intensité en COLOR.a. Dégradé lisse sans bruit ni texture (pas de grain
// ni de motif), estompé de près (un halo ne doit pas boucher l'écran) et au loin (le brouillard cache la distance).
// `fog_disabled` : le halo est additif, il ne doit pas être mangé par le brouillard de nuit (déjà sombre) ; on l'estompe nous-mêmes avec la distance.

uniform bool billboard = true;
uniform float gain = 1.0;            // 0 le jour (l'Aube éteint les lampadaires), 1 la nuit ; qualité Rapide : 0,8
uniform float fade_far = 140.0;
varying float vdist;

void vertex() {
	if (billboard) {
		MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
		MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0), vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, length(MODEL_MATRIX[2].xyz), 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	}
	vdist = length((MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
}

void fragment() {
	float d = length(UV - vec2(0.5)) * 2.0;
	float edge = clamp(1.0 - d, 0.0, 1.0);
	float a;
	if (billboard) {
		a = edge * edge * edge * (0.25 + 1.6 * pow(edge, 6.0));   // rayonnement large et doux + coeur plus vif
	} else {
		a = edge * edge * (3.0 - 2.0 * edge) * edge;               // flaque : très douce, nulle au bord
	}
	float near_fade = billboard ? smoothstep(1.5, 6.0, vdist) : 1.0;   // un halo qu'on touche presque disparaît
	float far_fade = 1.0 - smoothstep(fade_far * 0.5, fade_far, vdist);
	ALBEDO = COLOR.rgb * COLOR.a * a * gain * near_fade * far_fade;
}
