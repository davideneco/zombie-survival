// Reflet d'ambiance de src/graphics.js (buildEnv) : un petit ciel dessiné sur un canevas (dégradé haut / milieu / horizon / sol, de la nuit) + lueur de la lune, vu avec une
// intensité de scene.environmentIntensity = 0,16. Godot ne sait pas régler l'intensité des reflets du ciel indépendamment de la lumière ambiante (qui vient du même ciel) :
// les reflets du ciel sont coupés (reflected_light_source = désactivé) et les surfaces qui reflètent (eau, flaques) appellent cette fonction.
// Couleurs de CONFIG.graphics.env (nuit), en sRGB convertis en linéaire par la fonction.

uniform vec3 env_top : source_color = vec3(0.0392, 0.0706, 0.1333);      // #0a1222
uniform vec3 env_mid : source_color = vec3(0.1333, 0.1882, 0.2902);      // #22304a
uniform vec3 env_horizon : source_color = vec3(0.2902, 0.2275, 0.1725);  // #4a3a2c
uniform vec3 env_ground : source_color = vec3(0.0784, 0.0706, 0.0627);   // #141210
uniform vec3 env_moon_dir = vec3(0.6, 0.66, 0.36);
uniform float env_intensity = 0.16;
uniform float env_moon = 0.7;

vec3 env_sky(vec3 dir) {
	float el = asin(clamp(dir.y, -1.0, 1.0));            // -pi/2 .. pi/2
	float v = 0.5 - el / 3.14159265;                     // 0 en haut de l'équirectangulaire, 0,5 à l'horizon
	vec3 c = env_top;
	c = mix(c, env_mid, smoothstep(0.0, 0.42, v));
	c = mix(c, env_horizon, smoothstep(0.42, 0.5, v));
	c = mix(c, env_ground, smoothstep(0.5, 0.56, v));
	float a = acos(clamp(dot(dir, normalize(env_moon_dir)), -1.0, 1.0));
	c += vec3(0.402, 0.52, 1.0) * env_moon * exp(-pow(a / 0.45, 2.0)) * 0.6;   // tache de lune (rgb 170, 195, 255 en linéaire)
	return c * env_intensity;
}
