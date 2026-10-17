class_name GraphicsRules
extends RefCounted
## J9 : règles pures du paquet graphique (src/graphics.js) : niveaux de qualité, exposition et reflets par zone, interpolation nuit / aube / jour,
## table de couleurs 32^3 de l'étalonnage, conditions de la passe finale et du halo, bornes des particules et des taches de sang (fx.js).
## Sans nœud ni rendu : GraphicsView (scenes/graphics_view.gd) les applique. Toutes les valeurs viennent de CONFIG.graphics (Config) ; golden : tools/export-golden-j9.mjs.

const LUT_SIZE := 32          ## graphics.js buildLut : N
const DECALS_MAX := 64        ## fx.js : DECALS (taches allouées)

static func cfg() -> Dictionary:
	return Config.at("graphics")

## Niveau de qualité (0 Rapide, 1 Normale, 2 Haute), borné comme applyQuality.
static func level(q: int) -> Dictionary:
	var L: Array = cfg()["levels"]
	return L[clampi(q, 0, L.size() - 1)]

static func smoothstep01(x: float) -> float:
	return x * x * (3.0 - 2.0 * x)

## pickN de graphics.js : valeur à l'instant k (0 nuit, 0,5 aube, 1 jour) d'un tableau [nuit, aube, jour].
static func pick_n(a: Array, k: float) -> float:
	if k < 0.5:
		return float(a[0]) + (float(a[1]) - float(a[0])) * smoothstep01(k * 2.0)
	return float(a[1]) + (float(a[2]) - float(a[1])) * smoothstep01((k - 0.5) * 2.0)

## Réglages d'une zone (exposition, reflets, torche), ceux de « default » si la zone n'est pas listée.
static func zone(name: String) -> Dictionary:
	var Z: Dictionary = cfg()["zones"]
	return Z[name] if Z.has(name) else Z["default"]

## Un pas du lissage des valeurs de zone : 1 - exp(-dt x zoneBlend).
static func zone_blend(dt: float) -> float:
	return 1.0 - exp(-dt * float(cfg()["zoneBlend"]))

## applyExposure : exposition de base x Luminosité (Options) x exposition de la zone.
static func exposure(brightness: float, zone_exposure: float) -> float:
	return float(cfg()["tone"]["exposure"]) * brightness * zone_exposure

## Intensité des reflets d'ambiance (envIntensity) : base x phase x zone.
static func env_intensity(sky_k: float, zone_env: float) -> float:
	var E: Dictionary = cfg()["env"]
	return float(E["intensity"]) * pick_n(E["phaseIntensity"], sky_k) * zone_env

## Passe finale (table de couleurs) : niveau « post », option « Effets cinéma », et écran pas trop grand (mémoire de la cible multi-échantillonnée).
static func want_post(q: int, cinema: bool, width: int, height: int) -> bool:
	var P: Dictionary = cfg()["post"]
	if not (bool(level(q)["post"]) and bool(P["enabled"]) and cinema):
		return false
	return width * height <= int(P["maxPixels"])

## Halo : seulement avec la passe finale, si l'option « Halo lumineux » est cochée.
static func want_halo(q: int, cinema: bool, halo_setting: bool, width: int, height: int) -> bool:
	return want_post(q, cinema, width, height) and bool(cfg()["halo"]["enabled"]) and halo_setting

## Échantillons MSAA de la passe finale (cible multi-échantillonnée) : 2 sur les très grands écrans.
static func msaa_samples(width: int, height: int) -> int:
	var P: Dictionary = cfg()["post"]
	return 2 if width * height > int(P["msaa2Pixels"]) else int(P["samples"])

## Atténuation du halo à l'Aube : 1 - dawnFade x min(1, k x 1,6).
static func halo_dawn_gain(sky_k: float) -> float:
	var H: Dictionary = cfg()["halo"]
	return float(H["intensity"]) * (1.0 - float(H["dawnFade"]) * minf(1.0, sky_k * 1.6))

## fx.js emit : nombre de particules émises pour `count` demandées (part `particles` du niveau).
static func emit_count(count: int, particles: float) -> int:
	return count if particles >= 1.0 else maxi(1, roundi(count * particles))

## fx.js setQuality : taches de sang conservées.
static func decal_max(q: int) -> int:
	return mini(DECALS_MAX, int(level(q)["decals"]))

## Résolution de rendu (applyQuality) : 'device' -> 1 (la fenêtre Godot est déjà à la résolution de l'écran).
static func pixel_ratio(q: int) -> float:
	var r: Variant = level(q)["pixelRatio"]
	return 1.0 if typeof(r) == TYPE_STRING else float(r)

## Table de couleurs (buildLut) : octets RVBA de la bande 1024 x 32 (index ((g x W) + b x N + r) x 4), contraste en S, saturation, teintes ombres / hautes lumières.
static func lut_bytes() -> PackedByteArray:
	var G: Dictionary = cfg()["grade"]
	var n := LUT_SIZE
	var w := n * n
	var data := PackedByteArray()
	data.resize(w * n * 4)
	var contrast := float(G["contrast"])
	var sat := float(G["saturation"])
	var sh: Array = G["shadows"]
	var hi: Array = G["highlights"]
	for b in n:
		for g in n:
			for r in n:
				var c := [float(r) / (n - 1), float(g) / (n - 1), float(b) / (n - 1)]
				for i in 3:
					var x: float = c[i]
					var s := x * x * (3.0 - 2.0 * x)
					c[i] = x + (s - x) * contrast
				var l: float = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
				for i in 3:
					c[i] = l + (c[i] - l) * sat
				var sh_k := (1.0 - l) * (1.0 - l)
				var hi_k := l * l
				for i in 3:
					c[i] += float(sh[i]) * sh_k + float(hi[i]) * hi_k
				var o := ((g * w) + b * n + r) * 4
				for i in 3:
					data[o + i] = roundi(clampf(c[i], 0.0, 1.0) * 255.0)
				data[o + 3] = 255
	return data

## Même table, en Texture3D pour Environment.adjustment_color_correction (couche = bleu, x = rouge, y = vert).
static func lut_texture() -> ImageTexture3D:
	var bytes := lut_bytes()
	var n := LUT_SIZE
	var w := n * n
	var layers: Array[Image] = []
	for b in n:
		var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
		for g in n:
			for r in n:
				var o := ((g * w) + b * n + r) * 4
				img.set_pixel(r, g, Color8(bytes[o], bytes[o + 1], bytes[o + 2], 255))
		layers.append(img)
	var tex := ImageTexture3D.new()
	tex.create(Image.FORMAT_RGBA8, n, n, n, false, layers)
	return tex
