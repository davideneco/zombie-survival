shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_opaque;
#include "env_reflect.gdshaderinc"
// v0.36.0 : glazing of the drivable car (scenes/car_view.gd) : slightly tinted, see-through (the cabin is visible from outside, the street from
// inside), sky reflection by Fresnel (env_reflect), a little dust ; `broken` (wreck) hides it.

uniform float tint = 0.32;          // opacity seen straight on
uniform float dust = 0.12;
uniform float broken = 0.0;
uniform sampler2D noise_tex : hint_default_white, repeat_enable, filter_linear_mipmap;

varying vec3 lpos;

void vertex() {
	lpos = VERTEX;
}

void fragment() {
	if (broken > 0.5) {
		discard;
	}
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	vec3 vd = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);
	float fr = 0.04 + 0.96 * pow(1.0 - clamp(abs(dot(nw, vd)), 0.0, 1.0), 5.0);
	float n = texture(noise_tex, vec2(lpos.x * 0.8 + lpos.z * 0.3, lpos.y * 1.7)).r;
	float d = dust * (0.4 + 0.8 * n) * (1.0 - smoothstep(0.9, 1.4, lpos.y) * 0.5);
	ALBEDO = mix(vec3(0.02, 0.026, 0.03), vec3(0.32, 0.30, 0.27), d);
	ROUGHNESS = mix(0.04, 0.6, d);
	METALLIC = 0.0;
	SPECULAR = 0.7;
	ALPHA = clamp(tint + fr * 0.55 + d * 0.5, 0.0, 0.92);
	vec3 rd = reflect(-vd, FRONT_FACING ? nw : -nw);
	EMISSION = min(env_sky(rd) * fr * 3.0, vec3(0.05, 0.06, 0.07));
}
