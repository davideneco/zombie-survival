class_name MapImage
extends RefCounted
## Plan de la ville pour la carte plein écran. Le JS le peint depuis les données de génération (île, eau, polygones de bâtiments, passages) ;
## le port n'a que le monde cuit, donc le plan est tiré de la grille de navigation : case libre = rue (gris), case bloquée = bâti (brun),
## hors de la grille = fond ; tout ce qui est hors du secteur jouable est assombri (masque grossier de 4 m, élargi puis resserré comme
## dans realworld.js). Pas d'eau ni de passages dorés (écarts connus). Image du seul rectangle `mapCrop`, à `mapView.scale` pixels par mètre.

const STREET := Color8(52, 56, 62)
const BUILT := Color8(122, 106, 85)
const VOID := Color8(22, 24, 28)
const MASK_CELL := 4.0
const MASK_GROW := 6
const MASK_SHRINK := 3
const SAMPLE_STEP := 3

## world : World chargé. Renvoie l'image (RGB8) du rectangle `mapCrop`.
static func build(world: World) -> Image:
	var crop: Dictionary = world.objects["mapCrop"]
	var scale := float(world.objects["mapView"]["scale"])
	var x0 := float(crop["x0"])
	var z0 := float(crop["z0"])
	var w := int(round((float(crop["x1"]) - x0) * scale))
	var h := int(round((float(crop["z1"]) - z0) * scale))
	var nav: NavGrid = world.nav
	# masque grossier du secteur
	var gw := int(ceil((float(crop["x1"]) - x0) / MASK_CELL)) + 1
	var gh := int(ceil((float(crop["z1"]) - z0) / MASK_CELL)) + 1
	var mask := PackedByteArray()
	mask.resize(gw * gh)
	var step := SAMPLE_STEP * nav.cell
	for gz in gh:
		for gx in gw:
			var wx := x0 + gx * MASK_CELL
			var wz := z0 + gz * MASK_CELL
			var hit := 0
			for dz in 2:
				for dx in 2:
					if nav.zone_of(wx + dx * MASK_CELL * 0.5, wz + dz * MASK_CELL * 0.5) >= 0:
						hit = 1
			mask[gz * gw + gx] = hit
	mask = _grow(_grow(mask, gw, gh, MASK_GROW, 1), gw, gh, MASK_SHRINK, 0)
	var data := PackedByteArray()
	data.resize(w * h * 3)
	var nx := nav.nx
	var nz := nav.nz
	var blocked := nav.blocked
	var inv := 1.0 / scale
	var o := 0
	for py in h:
		var wz := z0 + (py + 0.5) * inv
		var iz := int(floor((wz - nav.oz) / nav.cell))
		var gz := clampi(int((wz - z0) / MASK_CELL), 0, gh - 1)
		for px in w:
			var wx := x0 + (px + 0.5) * inv
			var ix := int(floor((wx - nav.ox) / nav.cell))
			var c: Color
			if ix < 0 or iz < 0 or ix >= nx or iz >= nz:
				c = VOID
			elif blocked[iz * nx + ix] != 0:
				c = BUILT
			else:
				c = STREET
			var r := c.r8
			var g := c.g8
			var b := c.b8
			if mask[gz * gw + clampi(int((wx - x0) / MASK_CELL), 0, gw - 1)] == 0:
				r = int(r * 0.42)
				g = int(g * 0.42)
				b = int(b * 0.42)
			data[o] = r
			data[o + 1] = g
			data[o + 2] = b
			o += 3
	var _unused := step
	return Image.create_from_data(w, h, false, Image.FORMAT_RGB8, data)

## Dilatation (val = 1) ou érosion (val = 0) carrée de rayon r, en deux passes (lignes puis colonnes).
static func _grow(m: PackedByteArray, gw: int, gh: int, r: int, val: int) -> PackedByteArray:
	var tmp := m.duplicate()
	for j in gh:
		var base := j * gw
		for i in gw:
			if m[base + i] == val:
				continue
			for a in range(maxi(0, i - r), mini(gw, i + r + 1)):
				if m[base + a] == val:
					tmp[base + i] = val
					break
	var out := tmp.duplicate()
	for j in gh:
		for i in gw:
			if tmp[j * gw + i] == val:
				continue
			for b in range(maxi(0, j - r), mini(gh, j + r + 1)):
				if tmp[b * gw + i] == val:
					out[j * gw + i] = val
					break
	return out
