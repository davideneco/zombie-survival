class_name TramInterior
extends RefCounted
## Intérieur praticable de la rame : géométrie et collision LOCALES (port de src/tramInterior.js : interiorOf, pushOut, doorIndexAt).
## Repère de la rame « déroulé » : u le long de la rame depuis son centre (+ vers l'avant), w à droite, y hauteur des pieds.
## Obstacles : boîtes alignées sur les axes { u0, u1, w0, w1 } (sièges, pupitres, bouts, parois) ; les parois sont interrompues devant les portes
## quand elles sont ouvertes et que la rame est arrêtée.

## t : { L, M, seats: [{ hip: [x, y, z], module, driver }] }, door_starts : abscisses de début des 4 portes (depuis le début de la rame, m).
## Renvoie { boxes, walls_closed, walls_open, spans, u_end, seat_spots }.
static func interior_of(L: float, M: float, seats: Array, door_starts: Array) -> Dictionary:
	var W: Dictionary = Config.at("tram.walk")
	var C: Dictionary = Config.at("tram.car")
	var u_end := L / 2.0 - float(W["endGap"])
	var boxes: Array = []
	var seat_spots: Array = []
	for s: Dictionary in seats:
		var hip: Array = s["hip"]
		var u: float = -L / 2.0 + M / 2.0 + int(s["module"]) * M - float(hip[2])
		var w: float = hip[0]
		seat_spots.append({"u": u, "w": w, "driver": bool(s["driver"]), "side": signf(w)})
		if bool(s["driver"]):
			boxes.append(_box(u - 0.24, u + 0.24, -0.26, 0.26))
		else:
			boxes.append(_box(u - 0.28, u + 0.28, w - 0.22, w + 0.22))
	for dir in [-1.0, 1.0]:   # pupitres de cabine (un à chaque bout)
		var xd: float = dir * (L / 2.0 - 1.95)
		boxes.append(_box(xd - 0.27, xd + 0.27, -0.95, 0.95))
	boxes.append(_box(u_end, u_end + 2.0, -3.0, 3.0))   # bouts : le nez se resserre au-delà de u_end
	boxes.append(_box(-u_end - 2.0, -u_end, -3.0, 3.0))
	var spans: Array = []
	for d: float in door_starts:
		spans.append([d - L / 2.0, d - L / 2.0 + float(C["doorWidth"])])
	var closed: Array = []
	var open: Array = []
	for side in [-1.0, 1.0]:
		var w0: float = float(W["wall"]) if side > 0.0 else -float(W["wall"]) - float(W["thick"])
		var w1: float = float(W["wall"]) + float(W["thick"]) if side > 0.0 else -float(W["wall"])
		closed.append(_box(-u_end, u_end, w0, w1))
		var a := -u_end
		for sp: Array in spans:
			if sp[0] > a:
				open.append(_box(a, sp[0], w0, w1))
			a = maxf(a, sp[1])
		if u_end > a:
			open.append(_box(a, u_end, w0, w1))
	return {"boxes": boxes, "walls_closed": closed, "walls_open": open, "spans": spans, "u_end": u_end, "seat_spots": seat_spots}

static func _box(u0: float, u1: float, w0: float, w1: float) -> Dictionary:
	return {"u0": u0, "u1": u1, "w0": w0, "w1": w1}

## Pousse le cercle (rayon r) de centre p = { u, w } hors des boîtes de `lists` ; renvoie la plus grande poussée (m).
static func push_out(lists: Array, p: Dictionary, r: float) -> float:
	var best := 0.0
	for _pass in 2:
		for lst: Array in lists:
			for b: Dictionary in lst:
				var cu := clampf(p["u"], b["u0"], b["u1"])
				var cw := clampf(p["w"], b["w0"], b["w1"])
				var du: float = p["u"] - cu
				var dw: float = p["w"] - cw
				var d2 := du * du + dw * dw
				if d2 >= r * r:
					continue
				if d2 > 1e-10:
					var d := sqrt(d2)
					var k := (r - d) / d
					p["u"] += du * k
					p["w"] += dw * k
					best = maxf(best, r - d)
				else:   # centre dans la boîte : on sort par la face la plus proche
					var eu := minf(p["u"] - b["u0"], b["u1"] - p["u"])
					var ew := minf(p["w"] - b["w0"], b["w1"] - p["w"])
					if eu < ew:
						var dir_u: float = -1.0 if p["u"] - b["u0"] < b["u1"] - p["u"] else 1.0
						p["u"] = b["u0"] - r if dir_u < 0.0 else b["u1"] + r
						best = maxf(best, eu + r)
					else:
						var dir_w: float = -1.0 if p["w"] - b["w0"] < b["w1"] - p["w"] else 1.0
						p["w"] = b["w0"] - r if dir_w < 0.0 else b["w1"] + r
						best = maxf(best, ew + r)
	return best

## Porte (indice 0..3 dans spans) dont l'ouverture contient u (à `margin` m près), ou -1.
static func door_index_at(I: Dictionary, u: float, margin := 0.0) -> int:
	var spans: Array = I["spans"]
	for i in spans.size():
		if u >= spans[i][0] - margin and u <= spans[i][1] + margin:
			return i
	return -1
