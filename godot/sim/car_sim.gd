class_name CarSim
extends VehicleSim
## v0.36.0 : voiture conduisible de la carte de Strasbourg (propre au port : le jeu JS n'a pas de voiture). Citadine française générique, 4 places
## (conducteur à gauche + 3 passagers). Pur : aucun nœud. Hérite de VehicleSim (places, PV, feu, épave, essence, retour au point de départ, hôte Rides)
## sans rien y changer : la moto, le vélo et la motoneige gardent leur physique (golden JS de j5).
## Physique arcade propre :
##   - vitesse longitudinale `speed` (accélération qui faiblit près du maximum, frein, marche arrière après l'arrêt, résistance de l'air et
##     du roulement) et vitesse latérale `slip` (dérapage) : la vitesse vit dans le repère monde, le virage tourne la caisse, les pneus ramènent
##     la glisse vers 0 avec une accélération bornée (latGrip, hbGrip au frein à main) : au-delà, la voiture glisse un peu ;
##   - braquage qui diminue avec la vitesse (maxSteer / (1 + v x steerFade)), modèle « bicyclette », vitesse de lacet bornée par l'adhérence ;
##   - collision d'une BOÎTE ORIENTÉE (4,12 x 1,78 m) contre les segments, cercles et boîtes dynamiques de la collision du monde (axes séparateurs,
##     trois passes) ; le côté d'un mur fin est celui de la position précédente (pas de traversée) ; un choc tourne un peu la caisse (elle
##     s'aligne sur le mur) ; vitesse normale au mur annulée (léger rebond), frottement le long du mur ; marches et trous : on ne passe pas ;
##   - dégâts au contact d'un mur au-dessus de wall.free m/s (wall.perMs PV par m/s), occupants blessés au-dessus de crash.minSpeed (jamais mortel) ;
##   - écrasement des zombies au-dessus de roadkill.vmin (dégâts K x v x rampe, points de Game.hit_zombie comme la moto), zombie survivant
##     projeté sur le côté ; en dessous, la voiture pousse la foule au pas ;
##   - les motos et vélos garés sont poussés (ils sont légers), les autres voitures sont des obstacles (boîtes dynamiques de la collision).
## Repère local : x droite, y haut, z arrière (comme VehicleSim.to_world) ; l'avant est vers -z.

const DEF := {
	"name": "VOITURE", "hudName": "VOITURE", "det": "la", "seats": 4, "camArm": 6.4, "hp": 900, "tank": 35,
	"idle": 0.006, "gas": 0.03, "perSpeed": 0.05, "maxSpeed": 26.0, "accel": 7.5, "brake": 21.0, "reverseSpeed": 6.5,
	"drag": 0.045, "roll": 0.55, "wheelbase": 2.56, "track": 1.5, "maxSteer": 0.6, "steerFade": 0.075, "steerRate": 6.0,
	"grip": 11.0, "latGrip": 10.5, "hbGrip": 3.2, "hbYaw": 1.35, "slipDamp": 3.0, "hbDamp": 0.5, "radius": 1.0, "bikeRadius": 1.0,
	"length": 4.12, "width": 1.78, "height": 1.46,
	"roadkill": {"K": 30, "vmin": 6.0, "slowdown": 0.9, "kill": 3.0, "hurt": 8.0, "pushSpeed": 2.5},
	"crash": {"minSpeed": 9.0, "damagePerMs": 2.5, "maxDamage": 30},
	"wall": {"free": 3.0, "perMs": 9.0, "restitution": 0.12, "scrape": 0.35},
	"zombieHit": 12, "cabin": 0.3, "jerrican": 8.0, "startFuel": 0.6,
	"horn": {"cooldown": 1.0, "duration": 6.0, "range": 45.0},
	"model": "voiture", "wreckLift": 0.0, "cullDist": 0.0, "leanK": 0.0,
}
## Places : conducteur à gauche (on roule à droite), passager avant, deux places arrière. hip / eye en repère local (m).
const SEATS := [
	{"hip": [-0.37, 0.5, 0.12], "eye": [-0.37, 1.19, 0.18], "ry": 0.0},
	{"hip": [0.37, 0.5, 0.12], "eye": [0.37, 1.19, 0.18], "ry": 0.0},
	{"hip": [-0.38, 0.52, 0.98], "eye": [-0.38, 1.15, 1.04], "ry": 0.0},
	{"hip": [0.38, 0.52, 0.98], "eye": [0.38, 1.15, 1.04], "ry": 0.0},
]
## Emplacements sur la carte de Strasbourg (choisis par l'outil tests/test_place_cars.gd, vérifiés par la suite j43) : rues larges, hors des voies
## du tram, place libre autour, longue ligne droite devant. paint : indice de PAINTS (vue).
const SPOTS := [
	{"x": -191.1, "z": -132.1, "yaw": 1.4399, "paint": 0, "zone": "Place Kléber"},
	{"x": -15.6, "z": -481.1, "yaw": 2.0944, "paint": 1, "zone": "Quai Schoepflin"},
	{"x": -26.8, "z": 299.2, "yaw": 0.6545, "paint": 2, "zone": "Ancienne Douane (quai)"},
]
const PAINTS := ["bleu", "rouge", "gris", "vert"]
const PASSES := 3
const ZOMBIE_R := 0.4

var slip := 0.0          ## vitesse latérale (m/s, + vers la droite de la voiture)
var lights := false      ## phares allumés (touche de la lampe torche, en voiture)
var brake_lamp := false  ## feux stop (frein, frein à main)
var reversing := false   ## feux de recul
var horn_cd := 0.0
var horn_t := 0.0        ## > 0 : le klaxon sonne (vue, son)
var pitch := 0.0         ## tangage visuel (accélération / freinage), rad
var roll := 0.0          ## roulis visuel (virage), rad
var scrape := 0.0        ## vitesse de frottement contre un mur à ce pas (étincelles, son)
var contact := false     ## un obstacle a repoussé la caisse à ce pas
var last_impact := 0.0   ## vitesse normale du dernier choc (m/s, tests)
var unsettle_t := 0.0    ## après un choc, les pneus décrochent un instant (la voiture glisse le long du mur)
var spin := 0.0          ## vitesse de rotation donnée par un choc (rad/s, s'amortit) : la voiture pivote contre le mur
var paint := 0
var key := ""            ## clé de la boîte dynamique de la voiture dans la collision du monde
var _items: Array = []
var _fl2 := {"y": 0.0, "region": 0}

func _init(id_: int, sp: Dictionary) -> void:
	super(id_, "voiture", sp)
	paint = int(sp.get("paint", id_)) % PAINTS.size()
	key = "car:%d" % id_
	wheel_radius = 0.31
	for st: Dictionary in SEATS:
		model_seats.append(st.duplicate(true))
	fuel = float(def["tank"]) * float(def["startFuel"])

func reset() -> void:
	super.reset()
	slip = 0.0
	lights = false
	brake_lamp = false
	reversing = false
	horn_cd = 0.0
	horn_t = 0.0
	pitch = 0.0
	roll = 0.0
	scrape = 0.0
	contact = false
	spin = 0.0
	unsettle_t = 0.0

func half_w() -> float:
	return float(def["width"]) * 0.5
func half_l() -> float:
	return float(def["length"]) * 0.5

## Pivot de la vue externe : milieu du toit (la caméra suit l'axe de la voiture, pas l'œil du conducteur assis à gauche).
func cam_pivot(_seat: int) -> Vector3:
	return to_world([0.0, 1.45, 0.35])

## Boîte de collision pour Collision.set_dynamic (axe x local = (cos rot, sin rot) : la droite de la voiture).
func dyn_box() -> Dictionary:
	return {"x": x, "z": z, "w": float(def["width"]), "d": float(def["length"]), "rot": -yaw, "h": float(def["height"])}

## Point de la caisse le plus proche de (px, pz) (sur le bord si le point est dehors) : où un zombie vient frapper.
func closest_point(px: float, pz: float) -> Vector2:
	var rx := cos(yaw)
	var rz := -sin(yaw)
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var dx := px - x
	var dz := pz - z
	var lx := clampf(dx * rx + dz * rz, -half_w(), half_w())
	var lf := clampf(dx * fx + dz * fz, -half_l(), half_l())
	return Vector2(x + rx * lx + fx * lf, z + rz * lx + fz * lf)

## Le point (px, pz) est-il dans la caisse élargie de m mètres ?
func contains(px: float, pz: float, m := 0.0) -> bool:
	var dx := px - x
	var dz := pz - z
	return absf(dx * cos(yaw) - dz * sin(yaw)) <= half_w() + m and absf(-dx * sin(yaw) - dz * cos(yaw)) <= half_l() + m

## Vitesse au sol (m/s), dérapage compris.
func ground_speed() -> float:
	return sqrt(speed * speed + slip * slip)

## Deux cercles le long de l'axe (pour les chocs des motos contre la voiture : VehicleSim.collide_bikes).
func bike_circles() -> Array:
	var h := 1.1
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	return [x + fx * h, z + fz * h, x - fx * h, z - fz * h, 0.9]

func update(dt: float, g: Object, inp: Dictionary, driven: bool) -> void:
	if horn_cd > 0.0:
		horn_cd -= dt
	if horn_t > 0.0:
		horn_t -= dt
	scrape = 0.0
	contact = false
	super.update(dt, g, inp, driven)
	if not driven or state == "wreck" or state == "gone":
		brake_lamp = false
		reversing = false
		slip = 0.0
		pitch *= 0.9
		roll *= 0.9

# ------------------------------------------------------------------ conduite
func drive(dt: float, g: Object, inp: Dictionary) -> void:
	var D := def
	var on := state == "ok"   # en feu : moteur coupé, roue libre
	var fwd_key: bool = on and bool(inp.get("fwd", false))
	var back_key: bool = on and bool(inp.get("back", false))
	var hb: bool = bool(inp.get("hb", false))
	var steer_in: float = float(inp.get("steer", 0.0))
	var sp := speed
	var sp0 := speed
	var fs := _fuel_tick(dt, g, on)
	var dry: bool = fs[0]
	var miss: bool = fs[1]
	var FU: Dictionary = Config.at("vehicles.fuel")
	# vitesse longitudinale
	throttle = 0.0
	if fwd_key and not back_key:
		throttle = 1.0
		if sp < -0.3:
			sp = minf(0.0, sp + float(D["brake"]) * dt)
		elif dry:
			sp = minf(float(FU["pushSpeed"]), sp + float(FU["pushAccel"]) * dt) if sp < float(FU["pushSpeed"]) else _coast(sp, dt)
		elif miss:
			throttle = 0.0
			sp = _coast(sp, dt)
		else:
			sp += float(D["accel"]) * maxf(0.08, 1.0 - sp / float(D["maxSpeed"])) * dt
	elif back_key and not fwd_key:
		throttle = -1.0
		if sp > 0.3:
			sp = maxf(0.0, sp - float(D["brake"]) * dt)
		else:
			var lim := minf(float(D["reverseSpeed"]), float(FU["pushSpeed"])) if dry else float(D["reverseSpeed"])
			var acc := float(FU["pushAccel"]) if dry else float(D["accel"]) * 0.6
			sp = maxf(-lim, sp - acc * dt)
	else:
		sp = _coast(sp, dt)
	if hb:   # frein à main : roues arrière bloquées
		var b := float(D["brake"]) * 0.55 * dt
		sp = 0.0 if absf(sp) <= b else sp - signf(sp) * b
	sp = clampf(sp, -float(D["reverseSpeed"]), float(D["maxSpeed"]))
	brake_lamp = hb or (fwd_key and sp0 < -0.3) or (back_key and sp0 > 0.3)
	reversing = back_key and sp < 0.0
	# consommation : ralenti + gaz (marche arrière x 0,6)
	if has_tank() and on and fuel > 0.0:
		var gas := 0.0 if throttle == 0.0 else (float(D["gas"]) + float(D["perSpeed"]) * absf(sp) / float(D["maxSpeed"])) * (0.6 if throttle < 0.0 else 1.0)
		fuel = maxf(0.0, fuel - (float(D["idle"]) + gas) * dt)
	# direction : braquage qui diminue avec la vitesse ; lacet borné par l'adhérence (plus au frein à main : la voiture pivote)
	steer += (steer_in - steer) * minf(1.0, dt * float(D["steerRate"]))
	steer_angle = steer * float(D["maxSteer"]) / (1.0 + absf(sp) * float(D["steerFade"]))
	var yr := -(sp / float(D["wheelbase"])) * tan(steer_angle) * (float(D["hbYaw"]) if hb else 1.0)
	var lim_yaw := float(D["grip"]) * (1.5 if hb else 1.12) / maxf(3.0, absf(sp))
	yr = clampf(yr, -lim_yaw, lim_yaw)
	# la vitesse vit dans le repère monde : la caisse tourne, la vitesse suit par l'adhérence des pneus (bornée : dérapage)
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var vx := fx * sp + cos(yaw) * slip
	var vz := fz * sp - sin(yaw) * slip
	var yaw0 := yaw
	yaw += (yr + spin) * dt
	spin *= exp(-2.5 * dt)
	if absf(spin) < 1e-4:
		spin = 0.0
	fx = -sin(yaw)
	fz = -cos(yaw)
	var rx := cos(yaw)
	var rz := -sin(yaw)
	sp = vx * fx + vz * fz
	var sl := vx * rx + vz * rz
	var loose := hb or unsettle_t > 0.0
	if unsettle_t > 0.0:
		unsettle_t -= dt
	sl = move_toward(sl, 0.0, float(D["hbGrip"] if loose else D["latGrip"]) * dt)
	sl *= 1.0 - minf(1.0, float(D["hbDamp"] if loose else D["slipDamp"]) * dt)   # amortie : la glisse reste légère en virage serré
	sp -= signf(sp) * minf(absf(sp), absf(sl) * 0.9 * dt)   # la glisse freine
	slip = sl
	# tangage et roulis (vue seulement)
	pitch += (clampf(-(sp - sp0) / dt * 0.006, -0.05, 0.05) - pitch) * minf(1.0, dt * 6.0)
	roll += (clampf(yr * sp * 0.005, -0.06, 0.06) - roll) * minf(1.0, dt * 5.0)
	# déplacement + collision de la caisse
	vx = fx * sp + rx * slip
	vz = fz * sp + rz * slip
	var ox := x
	var oz := z
	x += vx * dt
	z += vz * dt
	var hit := _resolve(g, ox, oz)
	if _stepped(g):   # marche, trou : on ne passe pas
		x = ox
		z = oz
		yaw = yaw0
		var imp := sqrt(vx * vx + vz * vz)
		crash(imp, "wall", g)
		last_impact = imp
		sp = -sp * 0.15
		slip = 0.0
		speed = sp
		return
	if float(hit["depth"]) > 0.0:
		contact = true
		var nx := float(hit["nx"])
		var nz := float(hit["nz"])
		var vn := vx * nx + vz * nz
		if vn < 0.0:   # on fonce dans l'obstacle : vitesse normale annulée (léger rebond), frottement le long du mur
			var W: Dictionary = D["wall"]
			var impact := -vn
			vx -= nx * vn * (1.0 + float(W["restitution"]))
			vz -= nz * vn * (1.0 + float(W["restitution"]))
			var k := 1.0 - float(W["scrape"]) * clampf(impact / 8.0, 0.0, 1.0)
			var vnn := vx * nx + vz * nz
			vx = nx * vnn + (vx - nx * vnn) * k
			vz = nz * vnn + (vz - nz * vnn) * k
			scrape = sqrt(maxf(0.0, vx * vx + vz * vz - vnn * vnn))
			last_impact = impact
			# le coin qui touche fait pivoter la caisse (moment du choc autour du centre)
			var ccx := float(hit["cx"])
			var ccz := float(hit["cz"])
			spin = clampf(spin + (ccz * nx - ccx * nz) * impact * 1.0 / (ccx * ccx + ccz * ccz + 0.5), -2.5, 2.5)
			unsettle_t = maxf(unsettle_t, clampf(impact / 25.0, 0.0, 0.6))
			crash(impact, String(hit["kind"]), g)
		fx = -sin(yaw)
		fz = -cos(yaw)
		sp = vx * fx + vz * fz
		slip = vx * cos(yaw) - vz * sin(yaw)
	sp = clampf(sp, -float(D["reverseSpeed"]), float(D["maxSpeed"]))
	speed = sp
	_push_bikes(g)
	roadkill(g)

## Essence (copie des règles de VehicleSim.drive : réserve, bips, ratés, panne sèche). Renvoie [dry, miss].
func _fuel_tick(dt: float, g: Object, on: bool) -> Array:
	var FU: Dictionary = Config.at("vehicles.fuel")
	var frac := fuel_frac()
	var dry := on and fuel <= 0.0
	var miss := false
	if on and not dry and frac < float(FU["missBelow"]):
		miss_cd -= dt
		if miss_t > 0.0:
			miss_t -= dt
		elif miss_cd <= 0.0:
			miss_t = float(FU["missLen"])
			miss_cd = float(FU["missEvery"]) * (0.7 + 0.6 * g.rng.randf())
			events.append("cough")
		miss = miss_t > 0.0
	else:
		miss_t = 0.0
	if on and not dry and frac < float(FU["lowBelow"]):
		beep_t -= dt
		if beep_t <= 0.0:
			beep_t = float(FU["lowBeep"])
			events.append("beep")
	else:
		beep_t = 0.0
	if dry and not dry_noted:
		dry_noted = true
		events.append("dry")
	if not dry and fuel > 0.0:
		dry_noted = false
	return [dry, miss]

func _coast(sp: float, dt: float) -> float:
	var drag := (float(def["drag"]) * absf(sp) + float(def["roll"])) * dt
	return 0.0 if absf(sp) <= drag else sp - signf(sp) * drag

## Marche ou trou sous la caisse (milieu et quatre coins) : la voiture reste au sol de la rue.
func _stepped(g: Object) -> bool:
	if g.world == null:
		return false
	var hw := half_w() * 0.85
	var hl := half_l() * 0.85
	for p in [[0.0, 0.0], [-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]]:
		var w := to_world([p[0], 0.0, p[1]])
		g.world.floor_at(w.x, w.z, 0.1, _fl2)
		if int(_fl2["region"]) != 0 or absf(float(_fl2["y"])) > 0.25:
			return true
	return false

# ------------------------------------------------------------------ collision de la caisse (boîte orientée)
## Repousse la caisse hors des obstacles (segments, cercles, boîtes dynamiques sauf la sienne) ; (ox, oz) : position du pas précédent (côté
## d'un mur fin). Renvoie { depth (la plus forte poussée), nx, nz (sa normale, vers la voiture), kind }.
func _resolve(g: Object, ox: float, oz: float) -> Dictionary:
	var col: Collision = g.collision
	var out := {"depth": 0.0, "nx": 0.0, "nz": 0.0, "kind": "wall", "cx": 0.0, "cz": 0.0}
	var R := sqrt(half_w() * half_w() + half_l() * half_l()) + 0.6
	col.items_in(minf(x, ox) - R, minf(z, oz) - R, maxf(x, ox) + R, maxf(z, oz) + R, _items)
	for _pass in PASSES:
		var moved := false
		for it: Dictionary in _items:
			if not col.blocks(it, 0.1):
				continue
			var m: Vector3
			if it.has("r"):
				m = mtv_circle(float(it["x"]), float(it["z"]), float(it["r"]))
			else:
				m = mtv_segment(float(it["ax"]), float(it["az"]), float(it["bx"]), float(it["bz"]), ox, oz)
			if m.z > 1e-5:
				_push(m, out, String(it["kind"]))
				moved = true
		for k in col.dyn:
			if k == key:
				continue
			var e: Dictionary = col.dyn[k]
			for b: Dictionary in e["boxes"]:
				if 0.1 >= float(b["h"]) - 0.3:
					continue
				var dx := float(b["x"]) - x
				var dz := float(b["z"]) - z
				if dx * dx + dz * dz > float(b["r2"]) + R * R + 2.0 * R:
					continue
				var m2 := mtv_box(float(b["x"]), float(b["z"]), float(b["hx"]), float(b["hz"]), float(b["c"]), float(b["s"]))
				if m2.z > 1e-5:
					_push(m2, out, "car" if String(k).begins_with("car:") else String(e["kind"]))
					moved = true
		if not moved:
			break
	# bord de la zone de jeu
	var lim_x := col.half_x - half_l()
	var lim_z := col.half_z - half_l()
	var qx := clampf(x, -lim_x, lim_x)
	var qz := clampf(z, -lim_z, lim_z)
	if qx != x or qz != z:
		var ex := qx - x
		var ez := qz - z
		var el := sqrt(ex * ex + ez * ez)
		x = qx
		z = qz
		if el > float(out["depth"]):
			out = {"depth": el, "nx": ex / el, "nz": ez / el, "kind": "wall", "cx": 0.0, "cz": 0.0}
	return out

## Translation (m.x, m.y : normale ; m.z : profondeur) et petite rotation : le coin qui touche est repoussé, la caisse s'aligne sur l'obstacle.
func _push(m: Vector3, out: Dictionary, kind: String) -> void:
	var px := m.x * m.z
	var pz := m.y * m.z
	var rx := cos(yaw)
	var rz := -sin(yaw)
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var nr := m.x * rx + m.y * rz
	var nf := m.x * fx + m.y * fz
	var sr := 0.0 if absf(nr) < 0.25 else -signf(nr)
	var sf := 0.0 if absf(nf) < 0.25 else -signf(nf)
	var cx := rx * half_w() * sr + fx * half_l() * sf   # coin (ou milieu de face) qui touche, relatif au centre
	var cz := rz * half_w() * sr + fz * half_l() * sf
	x += px
	z += pz
	var dy := (cz * px - cx * pz) / (cx * cx + cz * cz + 0.5) * 0.6   # d(coin)/d(cap) = (cz, -cx)
	yaw += clampf(dy, -0.03, 0.03)
	if m.z > float(out["depth"]):
		out["depth"] = m.z
		out["nx"] = m.x
		out["nz"] = m.y
		out["kind"] = kind
		out["cx"] = cx
		out["cz"] = cz

## Vecteur de séparation minimal caisse / segment (axes séparateurs : droite et avant de la caisse, normale du segment) : Vector3(nx, nz, profondeur),
## la normale poussant la caisse hors du segment ; profondeur 0 sans contact. Pour la normale du segment, le côté est celui de (ox, oz).
func mtv_segment(ax: float, az: float, bx: float, bz: float, ox: float, oz: float) -> Vector3:
	var hw := half_w()
	var hl := half_l()
	var rx := cos(yaw)
	var rz := -sin(yaw)
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var sx := bx - ax
	var sz := bz - az
	var sl := sqrt(sx * sx + sz * sz)
	var axes: Array = [[rx, rz, false], [fx, fz, false]]
	if sl > 1e-6:
		axes.append([-sz / sl, sx / sl, true])
	var best := INF
	var bnx := 0.0
	var bnz := 0.0
	for a: Array in axes:
		var ux: float = a[0]
		var uz: float = a[1]
		var c := x * ux + z * uz
		var e := hw * absf(rx * ux + rz * uz) + hl * absf(fx * ux + fz * uz)
		var pa := ax * ux + az * uz
		var pb := bx * ux + bz * uz
		var smin := minf(pa, pb)
		var smax := maxf(pa, pb)
		if c + e <= smin or c - e >= smax:   # (un segment a une épaisseur nulle sur sa normale : le contact est un intervalle réduit à un point)
			return Vector3.ZERO
		var d_plus := smax - (c - e)    # pousser selon +u
		var d_minus := (c + e) - smin   # pousser selon -u
		var dir := 1.0 if d_plus < d_minus else -1.0
		if a[2]:   # normale d'un mur fin : on retourne du côté d'où l'on vient
			var side := (ox * ux + oz * uz) - pa
			if absf(side) > 1e-6:
				dir = signf(side)
		var depth := d_plus if dir > 0.0 else d_minus
		if depth < best:
			best = depth
			bnx = ux * dir
			bnz = uz * dir
	return Vector3(bnx, bnz, best)

## Caisse / cercle (pilier, arbre, borne) : Vector3(nx, nz, profondeur).
func mtv_circle(cx: float, cz: float, r: float) -> Vector3:
	var hw := half_w()
	var hl := half_l()
	var rx := cos(yaw)
	var rz := -sin(yaw)
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var dx := cx - x
	var dz := cz - z
	var lx := dx * rx + dz * rz
	var lf := dx * fx + dz * fz
	if absf(lx) > hw + r or absf(lf) > hl + r:
		return Vector3.ZERO
	var qx := clampf(lx, -hw, hw)
	var qf := clampf(lf, -hl, hl)
	var ex := lx - qx
	var ef := lf - qf
	var d2 := ex * ex + ef * ef
	if d2 >= r * r:
		return Vector3.ZERO
	if d2 > 1e-8:
		var d := sqrt(d2)
		return Vector3(-(ex * rx + ef * fx) / d, -(ex * rz + ef * fz) / d, r - d)
	var dxx := hw - absf(lx)
	var dff := hl - absf(lf)
	if dxx < dff:
		var s := -signf(lx) if lx != 0.0 else -1.0
		return Vector3(rx * s, rz * s, dxx + r)
	var s2 := -signf(lf) if lf != 0.0 else 1.0
	return Vector3(fx * s2, fz * s2, dff + r)

## Caisse / boîte dynamique de Collision (centre bx, bz ; demi-tailles bhx, bhz sur ses axes (c, s) et (-s, c)) : Vector3(nx, nz, profondeur).
func mtv_box(bx: float, bz: float, bhx: float, bhz: float, c: float, s: float) -> Vector3:
	var hw := half_w()
	var hl := half_l()
	var rx := cos(yaw)
	var rz := -sin(yaw)
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var best := INF
	var bnx := 0.0
	var bnz := 0.0
	for a: Array in [[rx, rz], [fx, fz], [c, s], [-s, c]]:
		var ux: float = a[0]
		var uz: float = a[1]
		var ca := x * ux + z * uz
		var ea := hw * absf(rx * ux + rz * uz) + hl * absf(fx * ux + fz * uz)
		var cb := bx * ux + bz * uz
		var eb := bhx * absf(c * ux + s * uz) + bhz * absf(-s * ux + c * uz)
		var ov := (ea + eb) - absf(ca - cb)
		if ov <= 0.0:
			return Vector3.ZERO
		if ov < best:
			best = ov
			var dir := 1.0 if ca >= cb else -1.0
			bnx = ux * dir
			bnz = uz * dir
	return Vector3(bnx, bnz, best)

## Motos et vélos dans la caisse : poussés (légers), abîmés par un choc rapide ; la voiture perd un peu de vitesse.
func _push_bikes(g: Object) -> void:
	if g.vehicles == null:
		return
	for o: VehicleSim in g.vehicles:
		if o == self or o is CarSim or (o.state != "ok" and o.state != "burning"):
			continue
		if Vector2(o.x - x, o.z - z).length() > half_l() + 2.0:
			continue
		var b := o.bike_circles()
		for j in [0, 2]:
			var m := mtv_circle(float(b[j]), float(b[j + 1]), float(b[4]))
			if m.z <= 1e-5:
				continue
			var vx := -sin(yaw) * speed + cos(yaw) * slip
			var vz := -cos(yaw) * speed - sin(yaw) * slip
			var closing := -(vx * m.x + vz * m.y)
			var q: Vector3 = g.collision.resolve(Vector3(o.x - m.x * m.z, 0.1, o.z - m.y * m.z), float(o.def["radius"]))
			o.x = q.x
			o.z = q.z
			if closing > 0.0:
				speed -= signf(speed) * minf(absf(speed), closing * 0.25)
			if closing > 4.0 and float(_bike_hit.get(o.id, 0.0)) <= g.time:
				_bike_hit[o.id] = g.time + 0.5
				g.damage_vehicle(o, (closing - 4.0) * 6.0, "crash")
				crash(closing * 0.5, "moto", g)

# ------------------------------------------------------------------ zombies
## Zombies au contact de la caisse, du côté où elle va : au-dessus de vmin, écrasés (dégâts, points de hit_zombie, voiture abîmée, ralentie) et
## projetés sur le côté ; en dessous, la voiture pousse la foule au pas (ils se dégagent par leur collision contre la boîte dynamique).
func roadkill(g: Object) -> bool:
	var R: Dictionary = Config.at("vehicles.roadkill")
	var RK: Dictionary = def["roadkill"]
	if absf(speed) < 0.05 and absf(slip) < 0.05:
		return false
	var rx := cos(yaw)
	var rz := -sin(yaw)
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var hw := half_w() + ZOMBIE_R + 0.05
	var hl := half_l() + ZOMBIE_R + 0.05
	var reach := hl + 1.0
	for zb: ZombieSim in g.zombies:
		if not zb.targetable():
			continue
		var dx := zb.pos.x - x
		var dz := zb.pos.z - z
		if absf(dx) > reach or absf(dz) > reach:
			continue
		var lx := dx * rx + dz * rz
		var lf := dx * fx + dz * fz
		if absf(lx) > hw or absf(lf) > hl:
			continue
		var l := sqrt(lx * lx + lf * lf)
		var closing := (slip * lx + speed * lf) / maxf(0.3, l)   # vitesse de la caisse vers le zombie
		if closing <= 0.3:
			continue
		if closing >= float(RK["vmin"]):
			if float(zb.run_over_until) > g.time:
				continue
			zb.run_over_until = g.time + float(R["cooldown"])
			var killed: bool = g.hit_zombie(zb, false, roadkill_damage(closing), 1.0)
			g.damage_vehicle(self, float(RK["kill"]) if killed else float(RK["hurt"]), "roadkill")
			speed *= float(RK["slowdown"])
			if not zb.dead:   # projeté sur le côté (du côté où il est, à droite s'il est pile devant)
				var side := signf(lx) if absf(lx) > 0.05 else 1.0
				var to := side * (hw + 0.15)
				zb.pos.x += rx * (to - lx)
				zb.pos.z += rz * (to - lx)
				zb.pos = g.collision.resolve(zb.pos, ZOMBIE_R)
		else:
			speed = signf(speed) * minf(absf(speed), float(RK["pushSpeed"]))
			slip = signf(slip) * minf(absf(slip), float(RK["pushSpeed"]))
	return false

## Écrasement à la vitesse sp : 0 sous vmin, puis K x v x rampe (même formule que la moto, constantes de la voiture).
func roadkill_damage(sp: float) -> float:
	var RK: Dictionary = def["roadkill"]
	var v := absf(sp)
	if v < float(RK["vmin"]):
		return 0.0
	return float(RK["K"]) * v * minf(1.0, 0.4 + 0.6 * (v - float(RK["vmin"])) / float(Config.at("vehicles.roadkill.rampSpeed")))

## Choc : secousse, bruit ; usure de la caisse au-dessus de wall.free m/s ; occupants blessés au-dessus de crash.minSpeed (jamais mortel : Rides).
func crash(impact: float, _kind: String, g: Object) -> void:
	if impact < 2.0:
		return
	g.shake = maxf(float(g.shake), minf(1.0, impact / 18.0))
	events.append("crash:%.3f" % minf(1.0, impact / 16.0))
	var W: Dictionary = def["wall"]
	var wear := maxf(0.0, impact - float(W["free"])) * float(W["perMs"])
	if wear > 0.0 and hit_t <= 0.0:
		hit_t = 0.25
		g.damage_vehicle(self, wear, "crash")
	var C: Dictionary = def["crash"]
	if impact < float(C["minSpeed"]) or crash_t > 0.0:
		return
	crash_t = 0.8
	g.hurt_occupants(self, minf(float(C["maxDamage"]), (impact - float(C["minSpeed"])) * float(C["damagePerMs"])))

## Klaxon : renvoie true s'il sonne (recharge `horn.cooldown` s).
func honk() -> bool:
	if horn_cd > 0.0 or state != "ok":
		return false
	horn_cd = float(def["horn"]["cooldown"])
	horn_t = 0.6
	return true
