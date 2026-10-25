shader_type spatial;
render_mode cull_disabled;
#include "env_reflect.gdshaderinc"
// v0.36.0 : drivable car (scenes/car_view.gd). One material for the body, trim, wheels and cabin: the part of each triangle is in COLOR.r (id / 16),
// a painted ambient occlusion in COLOR.g. Clear-coated metallic paint with the sky reflection of env_reflect (the scene's sky reflections are off),
// road grime on the lower body and the wheel arches, dust on the horizontal surfaces; seen from inside (back faces of the single-surface shell) a
// dark fabric trim (door panels, headliner). `burnt` turns everything into a charred wreck.
//  0 paint   1 black plastic   2 chrome   3 tyre   4 alloy rim   5 dark interior   6 interior plastic   7 wheel arch liner   8 number plate
//  9 brake disc   10 brake caliper   11 grille   12 seat fabric   13 rubber seal / wiper   14 dashboard screen (dark glass)

uniform vec3 paint : source_color = vec3(0.10, 0.22, 0.42);
uniform float metallic_paint = 0.45;
uniform float burnt = 0.0;
uniform float dirt = 0.32;
uniform float damage = 0.0;            // 0 new .. 1 wrecked : the paint gets duller and dirtier
uniform sampler2D noise_tex : hint_default_white, repeat_enable, filter_linear_mipmap;

varying vec3 lpos;
varying float part;
varying float vao;

void vertex() {
	lpos = VERTEX;
	part = COLOR.r * 16.0;
	vao = COLOR.g;
}

void fragment() {
	int id = int(part + 0.5);
	vec3 col = paint;
	float rough = 0.3;
	float metal = metallic_paint;
	float cc = 1.0;
	float refl = 0.8;
	float spec = 0.5;
	if (id == 1) { col = vec3(0.035, 0.036, 0.04); rough = 0.62; metal = 0.0; cc = 0.1; refl = 0.12; }
	else if (id == 2) { col = vec3(0.75, 0.76, 0.78); rough = 0.12; metal = 0.95; cc = 0.0; refl = 1.0; }
	else if (id == 3) { col = vec3(0.028, 0.028, 0.03); rough = 0.9; metal = 0.0; cc = 0.0; refl = 0.0; spec = 0.25; }
	else if (id == 4) { col = vec3(0.62, 0.63, 0.65); rough = 0.28; metal = 0.85; cc = 0.0; refl = 0.6; }
	else if (id == 5) { col = vec3(0.04, 0.04, 0.045); rough = 0.85; metal = 0.0; cc = 0.0; refl = 0.0; }
	else if (id == 6) { col = vec3(0.065, 0.065, 0.07); rough = 0.6; metal = 0.0; cc = 0.0; refl = 0.08; }
	else if (id == 7) { col = vec3(0.012, 0.012, 0.012); rough = 1.0; metal = 0.0; cc = 0.0; refl = 0.0; }
	else if (id == 8) { col = vec3(0.86, 0.87, 0.86); rough = 0.4; metal = 0.0; cc = 0.3; refl = 0.2; }
	else if (id == 9) { col = vec3(0.32, 0.31, 0.30); rough = 0.45; metal = 0.8; cc = 0.0; refl = 0.3; }
	else if (id == 10) { col = vec3(0.55, 0.07, 0.05); rough = 0.4; metal = 0.0; cc = 0.6; refl = 0.2; }
	else if (id == 11) { col = vec3(0.015, 0.016, 0.018); rough = 0.45; metal = 0.0; cc = 0.4; refl = 0.25; }
	else if (id == 12) { col = vec3(0.075, 0.075, 0.08); rough = 0.95; metal = 0.0; cc = 0.0; refl = 0.0; spec = 0.2; }
	else if (id == 13) { col = vec3(0.02); rough = 0.7; metal = 0.0; cc = 0.0; refl = 0.05; }
	else if (id == 14) { col = vec3(0.01, 0.012, 0.015); rough = 0.08; metal = 0.0; cc = 0.0; refl = 0.6; }
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	// grime : road dirt on the lower body (noise), dust on horizontal paint, more with damage
	float n = texture(noise_tex, vec2(lpos.x * 0.37 + lpos.z * 0.21, lpos.y * 1.3 + lpos.z * 0.11)).r;
	if (id == 0 || id == 1 || id == 4 || id == 8) {
		float low = 1.0 - smoothstep(0.18, 0.75, lpos.y);
		float top = smoothstep(0.8, 0.97, nw.y) * 0.5;
		float g = clamp((dirt + 0.4 * damage) * (low * (0.55 + 0.6 * n) + top * (0.3 + 0.4 * n)), 0.0, 0.85);
		col = mix(col, vec3(0.20, 0.18, 0.15), g);
		rough = mix(rough, 0.85, g);
		cc *= 1.0 - g;
		refl *= 1.0 - g;
	}
	if (id == 0) {
		rough = mix(rough, 0.55, damage * 0.6);
		col *= 1.0 - 0.25 * damage * n;
	}
	if (!FRONT_FACING && id == 0) {   // inside of the shell: door panels, pillars, headliner
		col = lpos.y > 1.3 ? vec3(0.32, 0.31, 0.29) : vec3(0.06, 0.06, 0.065);
		rough = 0.9;
		metal = 0.0;
		cc = 0.0;
		refl = 0.0;
	}
	col = mix(col, vec3(0.022, 0.02, 0.018) * (0.6 + 0.8 * n), burnt);
	rough = mix(rough, 0.95, burnt);
	metal = mix(metal, 0.1, burnt);
	cc *= 1.0 - burnt;
	refl *= 1.0 - burnt;
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metal;
	SPECULAR = spec;
	CLEARCOAT = cc;
	CLEARCOAT_ROUGHNESS = 0.06;
	AO = vao;
	vec3 em = vec3(0.0);
	if (refl > 0.0 && FRONT_FACING) {
		vec3 vd = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);
		vec3 rd = reflect(-vd, nw);
		float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(nw, vd), 0.0, 1.0), 5.0);
		em = min(env_sky(rd) * fr * refl * 2.0, vec3(0.035, 0.042, 0.05) * refl);
	}
	EMISSION = em;
}
