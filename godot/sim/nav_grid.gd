class_name NavGrid
extends RefCounted
## Grille de navigation de la carte (cases de 75 cm) cuite depuis src/nav.js : cases bloquées, zone de chaque case. J2 ne porte que les
## données et leurs accesseurs (portes qui libèrent des cases, zone d'un point) ; le champ de flux et les composantes sont du J3.
## Une case (ix, iz) a l'indice iz * nx + ix ; son centre est (ox + (ix + 0.5) cell, oz + (iz + 0.5) cell).

var nx := 0
var nz := 0
var cell := 0.75
var ox := 0.0
var oz := 0.0
var margin := 0.5
var blocked := PackedByteArray()      ## 1 = case bloquée (mur, mobilier, porte fermée)
var zone := PackedByteArray()         ## zone de chaque case, 255 = hors zone (zoneOf du jeu : cases bloquées voisines incluses)
var zone1 := PackedByteArray()        ## idem d'après le découpage d'origine (zoneOf1)

static func _gz(path: String, size: int) -> PackedByteArray:
	var raw := FileAccess.get_file_as_bytes(path)
	if raw.is_empty():
		push_error("NavGrid : %s illisible" % path)
		return PackedByteArray()
	return raw.decompress(size, FileAccess.COMPRESSION_GZIP)

func load_dir(dir: String, meta: Dictionary) -> void:
	nx = int(meta["nx"])
	nz = int(meta["nz"])
	cell = float(meta["cell"])
	ox = float(meta["ox"])
	oz = float(meta["oz"])
	margin = float(meta["margin"])
	var n := nx * nz
	blocked = _gz(dir + "nav/blocked.u8.gz", n)
	zone = _gz(dir + "nav/zone.i8.gz", n)
	zone1 = _gz(dir + "nav/zone1.i8.gz", n)

func inside(ix: int, iz: int) -> bool:
	return ix >= 0 and iz >= 0 and ix < nx and iz < nz

func idx(ix: int, iz: int) -> int:
	return iz * nx + ix

func cx(x: float) -> int:
	return int(floor((x - ox) / cell))

func cz(z: float) -> int:
	return int(floor((z - oz) / cell))

func world_x(ix: int) -> float:
	return ox + (ix + 0.5) * cell

func world_z(iz: int) -> float:
	return oz + (iz + 0.5) * cell

func is_blocked_at(x: float, z: float) -> bool:
	var ix := cx(x)
	var iz := cz(z)
	return not inside(ix, iz) or blocked[idx(ix, iz)] != 0

## Zone du point (-1 hors zone) : équivalent de world.zoneOf.
func zone_of(x: float, z: float) -> int:
	var ix := cx(x)
	var iz := cz(z)
	if not inside(ix, iz):
		return -1
	var v := zone[idx(ix, iz)]
	return -1 if v == 255 else v

func zone1_of(x: float, z: float) -> int:
	var ix := cx(x)
	var iz := cz(z)
	if not inside(ix, iz):
		return -1
	var v := zone1[idx(ix, iz)]
	return -1 if v == 255 else v
