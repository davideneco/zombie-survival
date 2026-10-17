shader_type spatial;
// Peau, visages et vêtements des zombies : port du matériau de src/zombieSkin.js. Deux atlas partagés (chair, tissus : 4 x 3 cellules de 256 px) ; chaque matériau
// choisit SA cellule (uniforme `cell` : x, y = coin, z, w = taille, en coordonnées Three.js : v vers le haut) ; relief (bump) tiré de la luminosité de l'atlas ;
// SANG : un masque de bruit partagé et un seuil par matériau (`blood`, 0..1) : à chaque touche le seuil baisse et des taches grandissent sur la peau et les vêtements.

uniform sampler2D atlas : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D blood_mask : filter_linear_mipmap, repeat_enable;
uniform vec4 cell = vec4(0.0, 0.666667, 0.25, 0.333333);
uniform vec4 tint = vec4(1.0);   // linéaire : THREE.Color.setHSL / setRGB travaillent dans l'espace linéaire
uniform float blood = 0.0;
uniform vec2 blood_seed = vec2(0.3, 0.7);
uniform float rough = 0.85;
uniform float bump_scale = 0.8;
uniform float flash = 0.0;           // rouge de dégât (0,1 s) : émission
uniform float bump_on = 1.0;         // 0 en qualité Rapide

varying vec2 luv;
varying vec3 lpos;

vec2 atlas_uv(vec2 uv) {
	vec2 t = uv * cell.zw + cell.xy;
	return vec2(t.x, 1.0 - t.y);
}

void vertex() {
	luv = UV;
	lpos = VERTEX;
}

void fragment() {
	vec2 auv = atlas_uv(luv);
	vec3 col = texture(atlas, auv).rgb * tint.rgb;
	float bl = 0.0;
	if (blood > 0.001) {
		float bm = texture(blood_mask, luv * vec2(1.6, 1.3) + blood_seed + lpos.xy * 5.0 + lpos.zz * vec2(3.1, 4.3)).r;
		float th = 0.97 - 0.52 * blood;
		bl = smoothstep(th, th + 0.09, bm);
		col = mix(col, vec3(0.17, 0.008, 0.01) * (0.65 + 0.7 * bm), bl * 0.94);
	}
	ALBEDO = col;
	ROUGHNESS = mix(rough, 0.4, bl);
	if (bump_on > 0.5) {
		// relief : gradient de la luminosité de l'atlas (bumpMap du JS, échelle 0,8)
		float e = 1.0 / 768.0;
		float l0 = dot(texture(atlas, auv).rgb, vec3(0.333));
		float lx = dot(texture(atlas, auv + vec2(e, 0.0)).rgb, vec3(0.333));
		float ly = dot(texture(atlas, auv + vec2(0.0, e)).rgb, vec3(0.333));
		vec2 g = vec2(lx - l0, ly - l0) * bump_scale * 6.0;
		NORMAL_MAP = vec3(0.5 - g.x * 0.5, 0.5 + g.y * 0.5, 1.0);
		NORMAL_MAP_DEPTH = 1.0;
	}
	EMISSION = vec3(0.4, 0.0, 0.0) * flash;
}
