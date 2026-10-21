shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
// v0.27.0 : effets au sol des nouveaux atouts (scenes/perk_fx_view.gd), dessinés sur UN quad à plat : rien n'est mis à l'échelle de façon non
// uniforme. mode 0 : anneau simple (ramassage, Ultime Volonté) ; 1 : décharge de la Cerise-foudre (anneau dentelé + éclairs) ;
// 2 : toile de la Veuve noire (rayons et cercles). k : avancement 0..1 (l'anneau s'étend vite puis s'efface).

uniform vec4 color : source_color = vec4(1.0);
uniform float k = 0.0;
uniform int mode = 0;
uniform float seed = 0.0;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float a = atan(p.y, p.x);
	float grow = 0.2 + 0.8 * (1.0 - pow(1.0 - min(1.0, k * (mode == 2 ? 6.0 : 3.0)), 2.0));
	float fade = 1.0 - k;
	float alpha = 0.0;
	if (mode == 1) {
		float jag = 0.035 * sin(a * 23.0 + seed + TIME * 41.0) + 0.025 * sin(a * 57.0 - TIME * 63.0);
		alpha = smoothstep(0.03, 0.0, abs(r - grow * 0.92 + jag));
		float bolts = pow(max(0.0, sin(a * 7.0 + seed * 3.0 + TIME * 25.0)), 40.0);
		alpha += bolts * step(r, grow * 0.92) * smoothstep(0.0, grow, r) * 0.9;
	} else if (mode == 2) {
		float spokes = smoothstep(0.012, 0.0, abs(sin(a * 6.0)) * r);
		float circ = smoothstep(0.012, 0.0, abs(fract(r * 4.0 + 0.5) - 0.5) * 0.25);
		alpha = max(spokes, circ) * step(r, grow * 0.97) * 0.8;
		alpha += smoothstep(0.025, 0.0, abs(r - grow * 0.97)) * 0.6;
	} else {
		alpha = smoothstep(0.05, 0.0, abs(r - grow * 0.94));
	}
	ALBEDO = color.rgb;
	ALPHA = clamp(alpha * fade * color.a, 0.0, 1.0);
}
