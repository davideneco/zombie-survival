shader_type sky;
// Ciel nocturne : port de src/sky.js (dégradé haut / milieu / bas, nuages fractals qui dérivent, disque lunaire et halo) + étoiles (realworld.js : 500 points).
// Dans la passe du cube de rayonnement (AT_CUBEMAP_PASS), le ciel rend le « ciel d'ambiance » : l'hémisphère de main.js (HemisphereLight 0x6677aa / 0x222018),
// qui devient l'éclairage ambiant diffus de toute la scène (Environment.ambient_light_source = SKY) et le reflet des flaques et de l'eau, avec le halo de la lune.
// Les couleurs sont en sRGB (hint source_color) ; les uniformes sont réglés par GraphicsView (le ciel de l'Aube, J10, repeint haut / milieu / bas et `k`).

uniform vec3 top : source_color = vec3(0.0157, 0.0275, 0.051);      // #04070d
uniform vec3 mid : source_color = vec3(0.047, 0.082, 0.133);        // #0c1522
uniform vec3 bot : source_color = vec3(0.106, 0.145, 0.208);        // #1b2535
uniform vec3 cloud_night : source_color = vec3(0.149, 0.204, 0.306); // CONFIG.graphics.sky.cloudNight
uniform vec3 moon_dir = vec3(0.6, 0.66, 0.36);
uniform float moon_size = 0.034;
uniform float moon_k = 1.0;       // 1 la nuit, s'efface avec l'aube
uniform float day_k = 0.0;
uniform vec3 sun_dir = vec3(0.9, 0.0, 0.3);
uniform float sun_k = 0.0;       // J10 : le soleil de l'Aube (summit.js buildSun : disque + halo additifs), 0 la nuit
uniform float cloud_cover = 1.0;  // 0 en qualité Rapide
uniform float stars_k = 1.0;      // visibles tant que k < 0,28
global uniform float cloud_time;  // temps du ciel (secondes) : uniforme GLOBAL (ajouté à l'exécution par graphics_view.gd) : un uniforme de matériau changé à chaque image ferait recalculer le rayonnement du ciel à chaque image
uniform vec3 hemi_sky : source_color = vec3(0.4, 0.467, 0.667);     // 0x6677aa
uniform vec3 hemi_ground : source_color = vec3(0.133, 0.125, 0.094); // 0x222018
uniform float ambient_scale = 0.49;  // 1,1 x luminosité / pi : l'énergie ambiante d'Environment est ignorée pour un ambiant venu du ciel, le facteur est donc dans le ciel

// hachage sans sinus (D. Hoskins) : le sinus du JS (hash21 de sky.js) perd sa précision sur GPU pour de grands arguments, et donnait des nuages en plaques ;
// la loi est la même (uniforme sur 0..1), les nuages ne sont donc pas à la même place que dans le JS
float hash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = p - i;
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
	float a = 0.5, s = 0.0;
	for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
	return s;
}

vec3 night_sky(vec3 d, float md) {
	float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5; // 1 au zénith, 0,5 à l'horizon
	vec3 col = v > 0.45 ? mix(mid, top, (v - 0.45) / 0.55) : mix(bot, mid, v / 0.45);
	float dens = 0.0;
	if (cloud_cover > 0.0 && d.y > 0.0) {
		vec2 cp = d.xz / (d.y + 0.3);
		float c1 = fbm(cp * 1.5 + vec2(cloud_time * 0.010, cloud_time * 0.004));
		float c2 = fbm(cp * 3.6 + vec2(-cloud_time * 0.016, cloud_time * 0.006) + 7.0);
		dens = smoothstep(0.46, 0.80, c1 * 0.78 + c2 * 0.34) * smoothstep(0.03, 0.30, d.y) * cloud_cover;
		vec3 night = cloud_night * (1.0 + 3.0 * pow(md, 14.0) * moon_k);
		vec3 day = mix(mid * 1.25 + 0.1, vec3(1.0), 0.65);
		// v0.32.3 : de jour, nuages modelés : dessous gris bleuté là où ils sont épais, bords et sommets éclairés
		float thick = smoothstep(0.55, 0.95, c1 * 0.78 + c2 * 0.34);
		day = mix(day, day * vec3(0.66, 0.70, 0.78), thick * 0.8);
		vec3 cc = mix(night, day, day_k) * (0.75 + 0.5 * c2);
		col = mix(col, cc, dens * 0.82);
	}
	if (moon_k > 0.0) {
		float cr = cos(moon_size);
		float disc = smoothstep(cr, cr + 0.00035, md);
		float maria = vnoise(d.xy * 90.0 + d.z * 40.0) * 0.5 + vnoise(d.zy * 210.0) * 0.25;
		vec3 moon_col = vec3(1.0, 0.96, 0.85) * (2.3 - 0.9 * maria);
		float halo = pow(md, 700.0) * 0.55 + pow(md, 60.0) * 0.18 + pow(md, 9.0) * 0.05;
		col += moon_k * (halo * vec3(0.55, 0.68, 1.0) * (1.0 - 0.6 * dens));
		col = mix(col, moon_col, disc * moon_k * (1.0 - 0.92 * dens));
	}
	// étoiles : une par maille de ~4 degrés (une sur deux environ : ~85 par stéradian, comme les 500 points du JS), disque d'un pixel et demi
	if (stars_k > 0.0 && d.y > 0.02) {
		float az = atan(d.z, d.x);
		const float N = 90.0;                               // mailles en azimut sur l'équateur
		float ring = floor(d.y * 14.0);                     // bandes d'égale surface en sin(élévation)
		float cols = max(6.0, floor(N * sqrt(max(1.0 - (ring + 0.5) / 14.0 * ((ring + 0.5) / 14.0), 0.02))));
		float cu = (az / 6.2831853 + 0.5) * cols;
		vec2 cell = vec2(floor(cu), ring);
		float h1 = hash(cell + 3.1), h2 = hash(cell + 11.7), h3 = hash(cell + 27.3);
		if (h1 < 0.62) {
			vec2 sp = vec2(floor(cu) + 0.2 + 0.6 * h2, ring + 0.2 + 0.6 * h3);
			float saz = (sp.x / cols - 0.5) * 6.2831853, sy = sp.y / 14.0;
			vec3 sd = normalize(vec3(cos(saz) * sqrt(max(1.0 - sy * sy, 0.0)), sy, sin(saz) * sqrt(max(1.0 - sy * sy, 0.0))));
			float ang = acos(clamp(dot(d, sd), -1.0, 1.0));
			float s = 1.0 - smoothstep(0.0007, 0.0016, ang);
			col += vec3(0.87, 0.9, 1.0) * s * stars_k * (0.55 + 0.9 * h2);
		}
	}
	if (sun_k > 0.0) {
		float sd = max(dot(d, normalize(sun_dir)), 0.0);
		// v0.32.3 : halo resserré (l'ancien pow 10 blanchissait un quart du ciel autour du soleil)
		col += sun_k * (vec3(1.0, 0.93, 0.7) * pow(sd, 1400.0) * 6.0 + vec3(1.0, 0.8, 0.45) * (pow(sd, 120.0) * 0.45 + pow(sd, 18.0) * 0.07));
	}
	return col;
}

void sky() {
	vec3 d = normalize(EYEDIR);
	float md = max(dot(d, normalize(moon_dir)), 0.0);
	if (AT_CUBEMAP_PASS) {
		// ciel d'ambiance : f(y) linéaire -> après convolution cosinus, l'irradiance vaut mix(sol, ciel, 0,5 + 0,5 n.y) comme l'hémisphère de Three.js
		float t = clamp(0.5 + 0.75 * d.y, 0.0, 1.0);
		vec3 amb = mix(hemi_ground, hemi_sky, t);
		COLOR = amb * ambient_scale;
	} else {
		COLOR = night_sky(d, md);
	}
}
