shader_type spatial;
render_mode cull_disabled;
// v0.30.0 : paint of the drivable tram (scenes/tram_body.gd), Citadis 405 of the CTS (Strasbourg) in spirit. One material for the whole shell: the
// region of each cell is in COLOR.r (id / 16, flat per cell), the builder decides it (bands, frames, nose, roof). Glossy clear-coated paint outside;
// seen from inside (back faces: the shell is a single surface) a dark trim.
//  0 white paint   1 gloss black (window band, frames)   2 grey skirt   3 CTS red stripe   4 CTS blue stripe   5 roof grey   6 dark bumper
//  7 destination display glass   8 lamp housing (black, glossy)   9 light grey (pillars of the doors, mirror arms)

uniform vec3 c_white : source_color = vec3(0.93, 0.94, 0.95);
uniform vec3 c_black : source_color = vec3(0.018, 0.02, 0.024);
uniform vec3 c_skirt : source_color = vec3(0.30, 0.32, 0.34);
uniform vec3 c_red : source_color = vec3(0.80, 0.05, 0.09);
uniform vec3 c_blue : source_color = vec3(0.0, 0.33, 0.66);
uniform vec3 c_roof : source_color = vec3(0.70, 0.72, 0.74);
uniform vec3 c_bumper : source_color = vec3(0.12, 0.13, 0.14);
uniform vec3 c_inside : source_color = vec3(0.23, 0.24, 0.26);
uniform vec3 c_light : source_color = vec3(0.62, 0.65, 0.68);
uniform sampler2D noise_tex : hint_default_white, repeat_enable, filter_linear_mipmap;
uniform float dirt = 0.35;            // road grime on the lower body

varying vec3 lpos;
varying float region;

void vertex() {
	lpos = VERTEX;
	region = COLOR.r * 16.0;
}

void fragment() {
	int r = int(region + 0.5);
	vec3 col = c_white;
	float rough = 0.28;
	float metal = 0.0;
	float cc = 1.0;
	if (r == 1) { col = c_black; rough = 0.12; }
	else if (r == 2) { col = c_skirt; rough = 0.55; cc = 0.2; }
	else if (r == 3) { col = c_red; rough = 0.3; }
	else if (r == 4) { col = c_blue; rough = 0.3; }
	else if (r == 5) { col = c_roof; rough = 0.5; metal = 0.3; cc = 0.3; }
	else if (r == 6) { col = c_bumper; rough = 0.45; cc = 0.4; }
	else if (r == 7) { col = vec3(0.01, 0.012, 0.012); rough = 0.06; }
	else if (r == 8) { col = vec3(0.01); rough = 0.08; }
	else if (r == 9) { col = c_light; rough = 0.35; metal = 0.4; }
	// grime: dust rising from the rails, darker toward the bottom, a little on the roof edges
	float n = texture(noise_tex, vec2(lpos.x * 0.21 + lpos.z * 0.13, lpos.y * 0.9)).r;
	float low = 1.0 - smoothstep(0.2, 1.1, lpos.y);
	col *= 1.0 - dirt * low * (0.35 + 0.5 * n);
	if (!FRONT_FACING) {
		col = c_inside;
		rough = 0.8;
		cc = 0.0;
		metal = 0.0;
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metal;
	CLEARCOAT = cc;
	CLEARCOAT_ROUGHNESS = 0.08;
	SPECULAR = 0.5;
}
