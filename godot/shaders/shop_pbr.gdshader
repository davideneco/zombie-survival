shader_type spatial;
render_mode cull_back;
// v0.28.0 : wall weapon panels, ammo stations and the mystery box (scenes/world/shop_models.gd, box_model.gd). Object-space triplanar mapping in metres,
// so every instance of a MultiMesh gets the same look whatever its size. Two families:
//  - use_maps: a packed Poly Haven set of godot/assets/pbr (a: albedo detail around 0.5, m: normal RG + roughness B + AO A), tinted (planks, beams);
//  - otherwise painted or bare metal: flat tint with a slow mottling, roughness and patina (grime / rust) from a noise texture.

uniform sampler2D a_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D m_tex : hint_default_white, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D noise_tex : hint_default_white, repeat_enable, filter_linear_mipmap;
uniform bool use_maps = false;
uniform vec3 tint : source_color = vec3(0.5);
uniform float scale = 1.0;            // m per repeat of the maps
uniform float roughness = 0.6;
uniform float metallic = 0.0;
uniform float normal_k = 1.0;
uniform vec3 grime_color : source_color = vec3(0.24, 0.18, 0.12);
uniform float grime = 0.0;            // patina amount (0..1)
uniform float grime_scale = 0.35;     // m per noise repeat
uniform float emission_k = 0.0;       // own glow (lit signs)
uniform vec3 emission_color : source_color = vec3(1.0);

varying vec3 lpos;
varying vec3 lnrm;

void vertex() {
	lpos = VERTEX;
	lnrm = NORMAL;
}

vec2 tri_uv(vec3 p, vec3 an, out int axis) {
	if (an.y > max(an.x, an.z)) {
		axis = 1;
		return p.xz;
	} else if (an.x > an.z) {
		axis = 0;
		return vec2(p.z, -p.y);
	}
	axis = 2;
	return vec2(p.x, -p.y);
}

void fragment() {
	vec3 N = normalize(lnrm);
	vec3 an = abs(N);
	int axis;
	vec2 uv = tri_uv(lpos, an, axis);
	float nz = texture(noise_tex, uv / grime_scale).r;
	float nz2 = texture(noise_tex, uv / (grime_scale * 0.23) + vec2(0.37, 0.71)).r;
	vec3 col = tint;
	float rough = roughness;
	float ao = 1.0;
	vec3 n_obj = N;
	if (use_maps) {
		vec3 a = texture(a_tex, uv / scale).rgb * 2.0;
		vec4 m = texture(m_tex, uv / scale);
		col = tint * a;
		rough = clamp(m.b * roughness + 0.08, 0.0, 1.0);
		ao = m.a;
		vec2 nxy = (m.rg * 2.0 - 1.0) * normal_k;
		vec3 T = axis == 1 ? vec3(1.0, 0.0, 0.0) : (axis == 0 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
		vec3 B = axis == 1 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, -1.0, 0.0);
		if (axis == 0 && N.x < 0.0) T = -T;
		if (axis == 2 && N.z < 0.0) T = -T;
		n_obj = normalize(T * nxy.x - B * nxy.y + N * sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
	} else {
		col *= 0.86 + 0.28 * nz2;
		rough = clamp(roughness + (nz2 - 0.5) * 0.25, 0.04, 1.0);
	}
	float g = smoothstep(0.52, 0.8, nz) * grime;
	col = mix(col, grime_color, g);
	rough = mix(rough, 0.92, g);
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metallic * (1.0 - g * 0.8);
	AO = ao;
	AO_LIGHT_AFFECT = 0.4;
	NORMAL = normalize((VIEW_MATRIX * MODEL_MATRIX * vec4(n_obj, 0.0)).xyz);
	EMISSION = emission_color * emission_k;
}
