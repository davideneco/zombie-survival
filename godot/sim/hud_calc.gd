class_name HudCalc
extends RefCounted
## Calculs purs du HUD (port de src/hud.js) : projection du radar, graduations de la boussole, cadrage de la carte, textes de l'inventaire
## et des bonus. Aucun nœud : les widgets (scenes/ui/) ne font que dessiner ce qu'ils renvoient ; contrôlés par les golden du JS.

const RADAR_SIZE := 120.0
const RADAR_RANGE := 36.0           ## mètres affichés sur le radar
const COMPASS_W := 420.0
const COMPASS_H := 30.0
const COMPASS_SPAN := 120.0         ## degrés visibles
const CARDINALS := [["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SO", 225], ["O", 270], ["NO", 315]]
const SHORT := {"m1911": "1911", "arex": "AREX", "deagle": "DEAGLE", "magnum": "PYTHON", "rifle": "M4A1", "ak47": "AK-47", "famas": "FAMAS", "scar": "SCAR",
	"smg": "MP40", "mp5": "MP5", "p90": "P90", "lmg": "RPK", "m249": "M249", "mg42": "MG42", "pkm": "PKM", "sniper": "L96", "svd": "SVD", "barrett": "M82",
	"shotgun": "870", "raygun": "RAYONS", "saiga": "SAIGA", "crossbow": "ARBALÈTE", "m79": "M79"}

## Point d'un objet (px, pz) sur le radar du joueur (pos, yaw) : position dans le carré de 120 px, ou (INF, INF) hors portée.
## Le radar est orienté selon la vue : « haut » = devant.
## range_m : mètres au bord du radar (RADAR_RANGE ; v0.27.0 : Sixième sens l'élargit).
static func radar_point(player_x: float, player_z: float, yaw: float, px: float, pz: float, range_m := RADAR_RANGE) -> Vector2:
	var cx := RADAR_SIZE / 2.0
	var r := RADAR_SIZE / 2.0 - 3.0
	var cos_y := cos(-yaw)
	var sin_y := sin(-yaw)
	var dx := px - player_x
	var dz := pz - player_z
	var rx := dx * cos_y + dz * sin_y
	var rz := -dx * sin_y + dz * cos_y
	if sqrt(rx * rx + rz * rz) > range_m:
		return Vector2(INF, INF)
	return Vector2(cx + rx / range_m * r, cx + rz / range_m * r)

## Cap de la boussole en degrés (0 = nord (-z), 90 = est (+x)).
static func heading_deg(yaw: float) -> float:
	return fposmod(fposmod(-yaw * 180.0 / PI, 360.0), 360.0)

## Graduations visibles : [{ x, deg, card ("" pour un simple trait) }] (drawCompass).
static func compass_ticks(yaw: float) -> Array:
	var heading := heading_deg(yaw)
	var out: Array = []
	var d: float = ceilf((heading - COMPASS_SPAN / 2.0) / 15.0) * 15.0
	while d <= heading + COMPASS_SPAN / 2.0:
		var x: float = COMPASS_W / 2.0 + ((d - heading) / COMPASS_SPAN) * COMPASS_W
		var deg := fposmod(d, 360.0)
		var card := ""
		for c: Array in CARDINALS:
			if float(c[1]) == deg:
				card = c[0]
		out.append({"x": x, "deg": deg, "card": card})
		d += 15.0
	return out

## Repère d'un coéquipier sur la boussole : position x et si le repère est collé au bord.
static func compass_mark(bearing_deg: float, heading: float) -> Dictionary:
	var df := fposmod(bearing_deg - heading + 540.0, 360.0) - 180.0
	var edge := absf(df) > COMPASS_SPAN / 2.0
	df = clampf(df, -COMPASS_SPAN / 2.0 + 6.0, COMPASS_SPAN / 2.0 - 6.0)
	return {"x": COMPASS_W / 2.0 + (df / COMPASS_SPAN) * COMPASS_W, "edge": edge}

## Cadrage de la carte plein écran (drawMap) : { k (pixels d'écran par pixel d'image), ox, oy, sw, sh } pour l'écran (w, h), le rectangle de
## l'île `crop` { x0, x1, z0, z1 } (mètres) et l'échelle `scale` de l'image (pixels par mètre).
static func map_layout(w: float, h: float, crop: Dictionary, scale: float) -> Dictionary:
	var sw := (float(crop["x1"]) - float(crop["x0"])) * scale
	var sh := (float(crop["z1"]) - float(crop["z0"])) * scale
	var k := minf((w - 60.0) / sw, (h - 110.0) / sh)
	return {"k": k, "ox": (w - sw * k) / 2.0, "oy": 50.0 + (h - 110.0 - sh * k) / 2.0, "sw": sw, "sh": sh}

## Point du monde (x, z) sur l'écran, d'après map_layout.
static func map_point(lay: Dictionary, crop: Dictionary, scale: float, x: float, z: float) -> Vector2:
	return Vector2(float(lay["ox"]) + (x - float(crop["x0"])) * scale * float(lay["k"]), float(lay["oy"]) + (z - float(crop["z0"])) * scale * float(lay["k"]))

## Taille de la police du nom d'une zone sur la carte : suit la surface de la zone (+3 pour la zone du joueur).
static func zone_font_size(area: float, here: bool) -> int:
	return roundi(11.0 + sqrt(area if area > 0.0 else 8000.0) / 20.0) + (3 if here else 0)

## Texte de l'inventaire : « 1: FUSIL · 2: POMPE+ » ; inv = [{ id, pap }], labels = nom de la touche de chaque emplacement.
static func inventory_parts(inv: Array, labels: PackedStringArray) -> Array:
	var out: Array = []
	for i in inv.size():
		var w: Dictionary = inv[i]
		var name := String(SHORT.get(w["id"], w["id"])) + "+".repeat(int(w.get("pap", 0)))
		out.append("%s: %s" % [labels[i] if i < labels.size() else str(i + 1), name])
	return out

## Texte des munitions : « 30 / 120 » ou « RECHARGEMENT… ».
static func ammo_text(mag: int, reserve: int, reloading: bool) -> String:
	return "RECHARGEMENT…" if reloading else "%d / %d" % [mag, reserve]

## Couleur de la barre de PV du véhicule : vert, orange sous 50 %, rouge sous 25 %.
static func hp_color(f: float) -> Color:
	return Color("e03030") if f < 0.25 else (Color("f0a030") if f < 0.5 else Color("3fbf5f"))

static func fuel_color(f: float) -> Color:
	return Color("e03030") if f < 0.15 else Color("e8b030")

## Libellé « 1 450 » → on garde le JS : le nombre brut.
static func points_text(p: int) -> String:
	return str(p)
