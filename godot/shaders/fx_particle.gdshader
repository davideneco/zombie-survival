shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, specular_disabled;
// Particules de src/fx.js : quadrilatères face à la caméra, cellule de l'atlas (8 de 128 px) et transparence par instance (INSTANCE_CUSTOM : x = cellule,
// y = opacité, z = rotation dans l'écran) ; la taille est la norme des colonnes de la matrice de l'instance. `lit` : éclairé (sang, poussière, débris) ou sans
// éclairage (flammes, fumée de moto, étincelles : visibles de nuit). Le brouillard s'applique aux deux.

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;
uniform bool lit = true;

varying float v_alpha;
varying vec2 v_uv;

void vertex() {
	float cell = INSTANCE_CUSTOM.x;
	v_alpha = INSTANCE_CUSTOM.y;
	vec2 cuv = vec2((UV.x + mod(cell, 4.0)) * 0.25, 0.5 * (floor(cell / 4.0) + UV.y));
	v_uv = cuv;
	vec3 centre = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float sx = length(MODEL_MATRIX[0].xyz), sy = length(MODEL_MATRIX[1].xyz);
	float c = cos(INSTANCE_CUSTOM.z), s = sin(INSTANCE_CUSTOM.z);
	vec2 o = vec2(VERTEX.x * sx, VERTEX.y * sy);
	vec4 mv = VIEW_MATRIX * vec4(centre, 1.0);
	mv.xy += vec2(c * o.x - s * o.y, s * o.x + c * o.y);
	POSITION = PROJECTION_MATRIX * mv;
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	vec4 t = texture(atlas, v_uv);
	ALBEDO = COLOR.rgb * (lit ? 1.0 : 1.0);
	ALPHA = t.a * v_alpha * COLOR.a;
	ROUGHNESS = 0.9;
	if (!lit) {
		EMISSION = COLOR.rgb;
		ALBEDO = vec3(0.0);
	}
}
