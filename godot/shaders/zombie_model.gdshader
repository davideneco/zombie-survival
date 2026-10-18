shader_type spatial;
render_mode cull_disabled;
// J16 : peau des zombies à modèles animés (Quaternius, atlas de 512 px). Le style cartoon du pack est assombri et sali pour s'accorder à la nuit de Strasbourg :
// désaturation, teinte par zombie, taches de crasse (masque de bruit partagé), pied du corps plus sale, SANG progressif (seuil par zombie, comme zombie_skin.gdshader)
// et flash rouge au coup. Un seul matériau partagé par tous les zombies ; teinte, sang, flash et graine sont des uniformes PAR INSTANCE (pas d'état de matériau).
// cull_disabled : l'intérieur du cou d'un zombie sans tête (face arrière) est peint en rouge sombre.

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D grime : filter_linear_mipmap, repeat_enable;
uniform float use_atlas = 1.0;                 // 0 : couleur unie (pièces d'armure)
uniform vec3 base_color : source_color = vec3(0.4, 0.42, 0.45);
uniform float desat = 0.3;
uniform float dirt = 0.7;
uniform float rough = 0.88;
uniform float metal = 0.0;
uniform float rim = 0.35;

instance uniform vec4 tint = vec4(0.62, 0.66, 0.56, 1.0);        
instance uniform vec4 colorize = vec4(0.0);   // rgb : couleur visée, a : part (pestiféré)
instance uniform float blood = 0.0;
instance uniform float flash = 0.0;
instance uniform float seed = 0.0;

varying vec3 lpos;

void vertex() {
	lpos = VERTEX;
}

void fragment() {
	vec3 c = mix(base_color, texture(atlas, UV).rgb, use_atlas);
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	c = mix(c, vec3(l), desat);
	c = mix(c, vec3(l) * colorize.rgb * 1.3, colorize.a);
	c *= tint.rgb;
	float g = texture(grime, lpos.xy * 2.2 + lpos.zz * vec2(1.7, 2.3) + vec2(seed, seed * 1.7)).r;
	c *= mix(1.0, 0.5, smoothstep(0.42, 0.85, g) * dirt);
	c *= mix(1.0 - 0.45 * dirt, 1.0, smoothstep(0.0, 0.55, lpos.y));
	float bl = 0.0;
	if (blood > 0.001) {
		float bm = texture(grime, lpos.xy * 3.1 + lpos.zz * vec2(3.1, 4.3) + vec2(seed * 2.3, seed)).r;
		float th = 0.97 - 0.52 * blood;
		bl = smoothstep(th, th + 0.09, bm);
		c = mix(c, vec3(0.17, 0.008, 0.01) * (0.65 + 0.7 * bm), bl * 0.94);
	}
	if (!FRONT_FACING) {
		c = vec3(0.13, 0.01, 0.015);
	}
	ALBEDO = c;
	ROUGHNESS = mix(rough, 0.4, bl);
	METALLIC = metal;
	RIM = rim;
	RIM_TINT = 0.4;
	EMISSION = vec3(0.45, 0.0, 0.0) * flash;
}
