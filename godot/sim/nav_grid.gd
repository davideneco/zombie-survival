class_name NavGrid
extends RefCounted
## Grille de navigation (port de src/nav.js) : cases bloquées, zones, champ de flux (distance de marche jusqu'aux joueurs), composantes
## connexes, direction à suivre (steer), lignes de vue. La grille de la carte (cases de 75 cm) est cuite depuis le JS (tools/bake-world.mjs) ;
## celles des étages se construisent ici (build_region) avec la même méthode que NavGrid.build du JS.
## Une case (ix, iz) a l'indice iz * nx + ix ; son centre est (ox + (ix + 0.5) cell, oz + (iz + 0.5) cell).
## blocked : 0 libre, 1 bloquée (mur, mobilier, porte fermée, bord), 2 obstacle enjambable (traversé par le champ de flux à vault_cost).
##
## Performance (R2 du plan) : le champ est un Dijkstra à seaux (coûts 10 / 14, 40 / 56 sur un obstacle enjambable). Les seaux forment un
## anneau de 64 (le coût d'un pas ne dépasse pas 56). Le bord de la grille est toujours bloqué (m cases), donc une case développée n'a jamais de
## voisin hors grille : aucun test de bornes dans la boucle. Le champ est incrémental (update_field, `budget` cases par appel, double tampon).

const INF_D := 0x3fffffff
const RING := 64

var nx := 0
var nz := 0
var cell := 0.75
var ox := 0.0
var oz := 0.0
var margin := 0.5
var blocked := PackedByteArray()      ## voir ci-dessus
var zone := PackedByteArray()         ## zone de chaque case, 255 = hors zone (zoneOf du jeu : cases bloquées voisines incluses)
var zone1 := PackedByteArray()        ## idem d'après le découpage d'origine (zoneOf1)
var vault_cost := 40                  ## CONFIG.zombie.vault.cost : coût d'une case enjambable (10 = case libre)
var dist := PackedInt32Array()        ## champ courant (fini) ; INF_D = pas de chemin
var dist_b := PackedInt32Array()      ## champ en cours de calcul
var job_active := false               ## un calcul incrémental est en cours
var version := 0                      ## incrémenté par invalidate() (porte ouverte)
var last_key := ""                    ## compute_field : cibles du dernier calcul complet
var field_swaps := 0                  ## nombre de champs terminés (suivi des tests et du banc d'essai)
var _ring: Array[PackedInt32Array] = []
var _task := -1                       ## tâche du fil de travail (update_field_threaded), -1 si aucune
var _jd := 0
var _jbi := 0
var _pending := 0
var _labels := PackedInt32Array()       ## composantes : étiquette par case (0 = bloquée), vide tant que non calculées
var _sizes: Array = []
var _parent := PackedInt32Array()       ## union-find des composantes : étiquette -> étiquette parente (identité tant qu'aucune porte n'a fusionné)
var _merged := false                    ## des composantes ont été fusionnées par free_cells() : `labels` brut n'est plus à jour (voir label_of)
var _warm_task := -1
var _vc_ortho := 40
var _vc_diag := 56

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
	_alloc()

func _alloc() -> void:
	dist = PackedInt32Array()
	dist.resize(nx * nz)
	dist.fill(INF_D)
	dist_b = PackedInt32Array()
	dist_b.resize(nx * nz)
	dist_b.fill(INF_D)
	_ring.clear()
	for _i in RING:
		_ring.append(PackedInt32Array())
	set_vault_cost(int(Config.at("zombie.vault.cost", 40)))

func set_vault_cost(c: int) -> void:
	vault_cost = c
	_vc_ortho = c
	_vc_diag = int(c * 1.4)   # nav.js : vaultCost * 1.4 (40 -> 56 exactement)

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

## Hors grille = bloqué ; 1 ou 2 = bloqué (2 : enjambable, bloqué pour tout sauf le champ de flux).
func is_blocked_at(x: float, z: float) -> bool:
	var ix := cx(x)
	var iz := cz(z)
	return not inside(ix, iz) or blocked[iz * nx + ix] != 0

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

## À appeler quand l'état des obstacles change (porte ouverte) : les composantes sont à refaire, le prochain calcul complet aussi.
func invalidate() -> void:
	last_key = ""
	version += 1
	_wait_warm()
	_labels = PackedInt32Array()
	_sizes = []
	_parent = PackedInt32Array()
	_merged = false

# ------------------------------------------------------------------ grille d'un étage (NavGrid.build du JS, sans polygones)
## Étage plat : cases praticables = plancher de la région, obstacles = ceux de cette hauteur (nav.walkable / nav.segFilter de levels.buildNavs).
static func build_region(levels: Levels, region: int, col: Collision, c := 0.5, m := 0.4) -> NavGrid:
	var R: Dictionary = levels.regions[region]
	var bb: Array = R["bbox"]
	var x0: float = bb[0] - 1.0
	var z0: float = bb[1] - 1.0
	var x1: float = bb[2] + 1.0
	var z1: float = bb[3] + 1.0
	var g := NavGrid.new()
	g.cell = c
	g.margin = m
	g.ox = x0
	g.oz = z0
	g.nx = int(round((x1 - x0) / c))
	g.nz = int(round((z1 - z0) / c))
	g.blocked = PackedByteArray()
	g.blocked.resize(g.nx * g.nz)
	g._alloc()
	g._build_region(levels, region, float(R["y"]), col)
	return g

func _build_region(levels: Levels, region: int, ry: float, col: Collision) -> void:
	var b := blocked
	for iz in nz:
		for ix in nx:
			b[iz * nx + ix] = 0 if levels.in_region(region, world_x(ix), world_z(iz)) else 1
	# on ne regarde que les obstacles qui touchent la grille (le test de hauteur est le plus cher)
	var x0 := ox - margin - 4.0
	var x1 := ox + nx * cell + margin + 4.0
	var z0 := oz - margin - 4.0
	var z1 := oz + nz * cell + margin + 4.0
	var plain: Array[Dictionary] = []
	var vaultable: Array[Dictionary] = []
	for s: Dictionary in col.segs:
		if s["off"] or maxf(s["ax"], s["bx"]) < x0 or minf(s["ax"], s["bx"]) > x1 or maxf(s["az"], s["bz"]) < z0 or minf(s["az"], s["bz"]) > z1:
			continue
		if col._blocks(s, ry):
			(plain if int(s["vid"]) == 0 else vaultable).append(s)
	var circ_plain: Array[Dictionary] = []
	var circ_vault: Array[Dictionary] = []
	for c: Dictionary in col.circles:
		if c["off"] or c["x"] < x0 or c["x"] > x1 or c["z"] < z0 or c["z"] > z1:
			continue
		if col._blocks(c, ry):
			(circ_plain if int(c["vid"]) == 0 else circ_vault).append(c)
	for s in plain:
		_mark(s["ax"], s["az"], s["bx"], s["bz"], margin)
	for c in circ_plain:
		_mark(c["x"], c["z"], c["x"], c["z"], float(c["r"]) + margin)
	var b1 := b.duplicate()
	for s in vaultable:
		_mark(s["ax"], s["az"], s["bx"], s["bz"], margin)
	for c in circ_vault:
		_mark(c["x"], c["z"], c["x"], c["z"], float(c["r"]) + margin)
	for i in b.size():
		if b[i] == 1 and b1[i] == 0:
			b[i] = 2
	var m := ceili(margin / cell)
	for i in nx:
		for k in m:
			b[idx(i, k)] = 1
			b[idx(i, nz - 1 - k)] = 1
	for i in nz:
		for k in m:
			b[idx(k, i)] = 1
			b[idx(nx - 1 - k, i)] = 1
	last_key = ""

## Marque 1 les cases dont le centre est à moins de r du segment (a, b) (nav.js : mark). Les « vid != 0 » marquent aussi 1 : le passage à 2 se fait après.
func _mark(ax: float, az: float, bx: float, bz: float, r: float) -> void:
	var ix0 := maxi(0, cx(minf(ax, bx) - r))
	var ix1 := mini(nx - 1, cx(maxf(ax, bx) + r))
	var iz0 := maxi(0, cz(minf(az, bz) - r))
	var iz1 := mini(nz - 1, cz(maxf(az, bz) + r))
	if ix0 > ix1 or iz0 > iz1:
		return
	var abx := bx - ax
	var abz := bz - az
	var len2 := abx * abx + abz * abz
	var r2 := r * r
	for iz in range(iz0, iz1 + 1):
		var pz := world_z(iz)
		for ix in range(ix0, ix1 + 1):
			var px := world_x(ix)
			var t := ((px - ax) * abx + (pz - az) * abz) / len2 if len2 > 0.0 else 0.0
			t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
			var dx := px - (ax + abx * t)
			var dz := pz - (az + abz * t)
			if dx * dx + dz * dz < r2:
				blocked[iz * nx + ix] = 1

# ------------------------------------------------------------------ composantes connexes
## Composantes connexes des cases libres (8 voisins, sans coin coupé) : { labels: PackedInt32Array (0 = case bloquée), sizes: [0, n1, n2…] }.
## Les cases enjambables (2) comptent comme bloquées, comme dans le JS. Mémorisées jusqu'au prochain invalidate().
func components() -> Dictionary:
	_wait_warm()
	if _merged:   # des portes ont fusionné des composantes : tableau brut périmé, on refait (outils et tests ; le jeu passe par label_of)
		_labels = PackedInt32Array()
		_merged = false
	if _labels.is_empty():
		_compute_components()
	return {"labels": _labels, "sizes": _sizes}

func _compute_components() -> void:
	var labels := PackedInt32Array()
	labels.resize(nx * nz)
	var sizes: Array = [0]
	var stack := PackedInt32Array()
	stack.resize(nx * nz)
	var n_all := nx * nz
	var b := blocked
	var w := nx
	for start in n_all:
		if b[start] != 0 or labels[start] != 0:
			continue
		var id := sizes.size()
		var n := 0
		var sp := 0
		labels[start] = id
		stack[sp] = start
		sp += 1
		while sp > 0:
			sp -= 1
			var i := stack[sp]
			n += 1
			var ix := i % w
			var iz := i / w
			for k in 8:
				var dx := 0
				var dz := 0
				match k:
					0: dx = 1
					1: dx = -1
					2: dz = 1
					3: dz = -1
					4:
						dx = 1
						dz = 1
					5:
						dx = 1
						dz = -1
					6:
						dx = -1
						dz = 1
					_:
						dx = -1
						dz = -1
				var jx := ix + dx
				var jz := iz + dz
				if jx < 0 or jz < 0 or jx >= w or jz >= nz:
					continue
				var j := jz * w + jx
				if b[j] != 0 or labels[j] != 0:
					continue
				if dx != 0 and dz != 0 and (b[iz * w + jx] != 0 or b[jz * w + ix] != 0):
					continue
				labels[j] = id
				stack[sp] = j
				sp += 1
		sizes.append(n)
	_labels = labels
	_sizes = sizes
	_parent = PackedInt32Array()
	_parent.resize(sizes.size())
	for i in sizes.size():
		_parent[i] = i

## Calcule les composantes sur un fil de travail (au chargement de la partie) : le premier appel de components() / label_of() attend la fin.
func warm_components() -> void:
	if _warm_task < 0 and _labels.is_empty():
		_warm_task = WorkerThreadPool.add_task(_compute_components)

func _wait_warm() -> void:
	if _warm_task >= 0:
		var t := _warm_task
		_warm_task = -1
		WorkerThreadPool.wait_for_task_completion(t)

func _find(l: int) -> int:
	var r := l
	while _parent[r] != r:
		r = _parent[r]
	while _parent[l] != r:
		var up := _parent[l]
		_parent[l] = r
		l = up
	return r

## Composante de la case i (0 = bloquée) : racine de l'union-find, à jour après les portes. Remplace components()["labels"][i] dans le jeu.
func label_of(i: int) -> int:
	_wait_warm()
	if _labels.is_empty():
		_compute_components()
	var l := _labels[i]
	return _find(l) if _merged and l != 0 else l

## Taille (en cases) de la composante `l` (étiquette rendue par label_of).
func comp_size(l: int) -> int:
	label_of(0)
	return int(_sizes[_find(l) if _merged else l])

## Plus grande composante (étiquette racine).
func comp_largest() -> int:
	label_of(0)
	var best := 1
	for i in range(1, _sizes.size()):
		if (not _merged or _parent[i] == i) and int(_sizes[i]) > int(_sizes[best]):
			best = i
	return best

func _joined(u: int, v: int, dx: int, dz: int) -> bool:
	if blocked[u] != 0 or blocked[v] != 0:
		return false
	return dx == 0 or dz == 0 or (blocked[u + dx] == 0 and blocked[u + dz * nx] == 0)

## Libère des cases (porte ouverte) et met les composantes à jour LOCALEMENT, sans tout recalculer (le calcul complet coûtait ~1,5 s) :
## chaque case libérée reçoit une étiquette neuve, puis on fusionne (union-find) avec ses voisines tant que l'arête est permise, y compris
## les diagonales dont une case orthogonale vient d'être libérée. Résultat équivalent à un recalcul complet (aux numéros d'étiquette près).
func free_cells(cells: Array) -> void:
	_wait_warm()
	var freed: Array[int] = []
	for c: int in cells:
		if blocked[c] != 0:
			blocked[c] = 0
			freed.append(c)
	last_key = ""
	version += 1
	if _labels.is_empty() or freed.is_empty():
		return
	for c in freed:
		_labels[c] = _sizes.size()
		_parent.append(_sizes.size())
		_sizes.append(1)
	var seen := {}
	for f in freed:
		var fx := f % nx
		var fz := f / nx
		for uz in range(maxi(fz - 1, 1), mini(fz + 2, nz - 1)):
			for ux in range(maxi(fx - 1, 1), mini(fx + 2, nx - 1)):
				var u := uz * nx + ux
				if blocked[u] != 0 or seen.has(u):
					continue
				seen[u] = true
				for dz in range(-1, 2):
					for dx in range(-1, 2):
						if dx == 0 and dz == 0:
							continue
						var v := u + dz * nx + dx
						if not _joined(u, v, dx, dz):
							continue
						var lu := _labels[u]
						var lv := _labels[v]
						if lu == lv:
							continue
						var ra := _find(lu)
						var rb := _find(lv)
						if ra == rb:
							continue
						if int(_sizes[ra]) < int(_sizes[rb]):
							var tmp := ra
							ra = rb
							rb = tmp
						_parent[rb] = ra
						_sizes[ra] = int(_sizes[ra]) + int(_sizes[rb])
	_merged = true

# ------------------------------------------------------------------ cases
## Case libre la plus proche (spirale, comme nav.js) : indice de case, -1 si aucune.
func nearest_free(x: float, z: float, max_r := 12) -> int:
	var ix := cx(x)
	var iz := cz(z)
	if inside(ix, iz) and blocked[idx(ix, iz)] == 0:
		return idx(ix, iz)
	for r in range(1, max_r + 1):
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dz)) != r:
					continue
				var jx := ix + dx
				var jz := iz + dz
				if inside(jx, jz) and blocked[idx(jx, jz)] == 0:
					return idx(jx, jz)
	return -1

func _starts_for(targets: Array) -> PackedInt32Array:
	var starts := PackedInt32Array()
	for t: Vector3 in targets:
		var s := nearest_free(t.x, t.z)
		if s >= 0 and not starts.has(s):
			starts.append(s)
	return starts

# ------------------------------------------------------------------ champ de distances
## Calcul complet, d'un coup (grilles d'étage, petites). targets : Array de Vector3 (x, z). Renvoie false s'il n'y a aucune cible.
func compute_field(targets: Array, max_cost := 0x3fffffff) -> bool:
	var starts := _starts_for(targets)
	if starts.is_empty():
		return false
	var sorted := Array(starts)
	sorted.sort()
	var key := ",".join(PackedStringArray(sorted.map(func(v): return str(v))))
	if key == last_key:
		return true
	last_key = key
	_begin_job(starts)
	_run(0x3fffffff, max_cost)
	_finish_job()
	return true

## Champ incrémental autour des cibles : `budget` cases développées par appel, puis échange des tampons. max_cost : coût maximal exploré
## (10 par case, 14 en diagonale ; 160 m de marche = 160 / cell x 10) ; au-delà les cases restent sans chemin (steer rend false).
## Renvoie true tant qu'un calcul est en cours (l'appelant peut espacer les relances une fois fini : job_active == false).
func update_field(targets: Array, budget := 50000, max_cost := 0x3fffffff) -> bool:
	if not job_active:
		var starts := _starts_for(targets)
		if starts.is_empty():
			return false
		_begin_job(starts)
	if _run(budget, max_cost):
		return true
	_finish_job()
	return false

## Variante sur un fil de travail : le calcul tourne en arrière-plan (WorkerThreadPool) et les tampons ne sont échangés qu'à la fin, sur le fil
## appelant. Le résultat est le même que update_field ; seul le moment de l'échange dépend de la machine (donc pas pour les tests reproductibles).
## Renvoie true tant qu'un calcul est en cours.
func update_field_threaded(targets: Array, max_cost := 0x3fffffff) -> bool:
	if _task >= 0:
		if not WorkerThreadPool.is_task_completed(_task):
			return true
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
		_finish_job()
		return false
	var starts := _starts_for(targets)
	if starts.is_empty():
		return false
	_begin_job(starts)
	_task = WorkerThreadPool.add_task(_run_all.bind(max_cost))
	return true

func _run_all(max_cost: int) -> void:
	_run(1 << 30, max_cost)

## Attend la fin d'un calcul sur fil (fermeture de la partie, tests).
func finish_threaded() -> void:
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
		_finish_job()

func _begin_job(starts: PackedInt32Array) -> void:
	dist_b.fill(INF_D)
	for r in _ring:
		r.clear()
	_pending = 0
	for s in starts:
		dist_b[s] = 0
		_ring[0].append(s)
		_pending += 1
	_jd = 0
	_jbi = 0
	job_active = true

func _finish_job() -> void:
	var t := dist
	dist = dist_b
	dist_b = t
	field_swaps += 1
	last_key = ""
	job_active = false

## Développe jusqu'à `budget` cases. Renvoie true si le calcul n'est pas fini (budget épuisé).
func _run(budget: int, max_cost: int) -> bool:
	var w := nx
	var b := blocked
	var dd := dist_b
	var ring := _ring
	var vo := _vc_ortho
	var vd := _vc_diag
	var d := _jd
	var bi := _jbi
	var pending := _pending
	var ops := 0
	while pending > 0 and d <= max_cost:
		var bucket: PackedInt32Array = ring[d & 63]
		var n := bucket.size()
		while bi < n:
			var i := bucket[bi]
			bi += 1
			pending -= 1
			if dd[i] != d:
				continue
			# 4 voisins orthogonaux
			var bl := b[i - 1]
			var br := b[i + 1]
			var bu := b[i - w]
			var bd := b[i + w]
			var j := i - 1
			if bl != 1:
				var nd := d + (vo if bl == 2 else 10)
				if nd < dd[j]:
					dd[j] = nd
					ring[nd & 63].append(j)
					pending += 1
			j = i + 1
			if br != 1:
				var nd := d + (vo if br == 2 else 10)
				if nd < dd[j]:
					dd[j] = nd
					ring[nd & 63].append(j)
					pending += 1
			j = i - w
			if bu != 1:
				var nd := d + (vo if bu == 2 else 10)
				if nd < dd[j]:
					dd[j] = nd
					ring[nd & 63].append(j)
					pending += 1
			j = i + w
			if bd != 1:
				var nd := d + (vo if bd == 2 else 10)
				if nd < dd[j]:
					dd[j] = nd
					ring[nd & 63].append(j)
					pending += 1
			# diagonales : pas de coin coupé (les deux cases orthogonales doivent être libres)
			if bl == 0 and bu == 0:
				j = i - w - 1
				var bj := b[j]
				if bj != 1:
					var nd := d + (vd if bj == 2 else 14)
					if nd < dd[j]:
						dd[j] = nd
						ring[nd & 63].append(j)
						pending += 1
			if br == 0 and bu == 0:
				j = i - w + 1
				var bj := b[j]
				if bj != 1:
					var nd := d + (vd if bj == 2 else 14)
					if nd < dd[j]:
						dd[j] = nd
						ring[nd & 63].append(j)
						pending += 1
			if bl == 0 and bd == 0:
				j = i + w - 1
				var bj := b[j]
				if bj != 1:
					var nd := d + (vd if bj == 2 else 14)
					if nd < dd[j]:
						dd[j] = nd
						ring[nd & 63].append(j)
						pending += 1
			if br == 0 and bd == 0:
				j = i + w + 1
				var bj := b[j]
				if bj != 1:
					var nd := d + (vd if bj == 2 else 14)
					if nd < dd[j]:
						dd[j] = nd
						ring[nd & 63].append(j)
						pending += 1
			ops += 1
			if ops >= budget:
				_jd = d
				_jbi = bi
				_pending = pending
				return true
		ring[d & 63].clear()
		bi = 0
		d += 1
	_jd = d
	_jbi = bi
	_pending = pending
	return false

## Distance de marche (m) de la case de (x, z) à la cible, INF si aucune.
func walk_distance(x: float, z: float) -> float:
	var ix := cx(x)
	var iz := cz(z)
	if not inside(ix, iz):
		return INF
	var d := dist[iz * nx + ix]
	return INF if d >= INF_D else (d / 10.0) * cell

# ------------------------------------------------------------------ lignes et direction
## Ligne de vue libre entre deux points ? (la dernière case n'est pas testée)
func los(x0: float, z0: float, x1: float, z1: float) -> bool:
	var dx := x1 - x0
	var dz := z1 - z0
	var steps := ceili(sqrt(dx * dx + dz * dz) / (cell * 0.5))
	var inv := 1.0 / maxi(steps, 1)
	for i in range(1, steps):
		var t := i * inv
		if is_blocked_at(x0 + dx * t, z0 + dz * t):
			return false
	return true

## Ligne droite libre pour un zombie ? (la dernière case est testée aussi : sinon on viserait à travers un mur mince)
func clear(x0: float, z0: float, x1: float, z1: float) -> bool:
	var dx := x1 - x0
	var dz := z1 - z0
	var steps := ceili(sqrt(dx * dx + dz * dz) / (cell * 0.5))
	var inv := 1.0 / maxi(steps, 1)
	for i in range(1, steps + 1):
		var t := i * inv
		if is_blocked_at(x0 + dx * t, z0 + dz * t):
			return false
	return true

## Direction (x, z unitaire) à suivre pour rejoindre la cible ; false = chemin inconnu. Le résultat est dans steer_x, steer_z (des float : pas de Vector2, en simple précision).
var steer_x := 0.0
var steer_z := 0.0
func steer(x: float, z: float) -> bool:
	var ix := cx(x)
	var iz := cz(z)
	if not inside(ix, iz):
		return false
	var w := nx
	var best := dist[iz * w + ix]
	var bx := ix
	var bz := iz
	# dans la marge d'un mur (case bloquée) : seuls les voisins immédiats sont sûrs, sinon on viserait à travers le mur
	var R := 1 if blocked[iz * w + ix] != 0 else maxi(2, int(round(2.0 / cell)))
	for dz in range(-R, R + 1):
		for dx in range(-R, R + 1):
			var jx := ix + dx
			var jz := iz + dz
			if jx < 0 or jz < 0 or jx >= w or jz >= nz:
				continue
			var d := dist[jz * w + jx]
			if d >= best:
				continue
			# voisins immédiats : atteignables (sauf coin coupé) ; plus loin : ligne droite libre exigée
			if absi(dx) <= 1 and absi(dz) <= 1:
				if dx != 0 and dz != 0 and (blocked[iz * w + jx] != 0 or blocked[jz * w + ix] != 0):
					continue
			elif not clear(x, z, world_x(jx), world_z(jz)):
				continue
			best = d
			bx = jx
			bz = jz
	if best >= INF_D or (bx == ix and bz == iz):
		return false
	var vx := world_x(bx) - x
	var vz := world_z(bz) - z
	var l := sqrt(vx * vx + vz * vz)
	if l == 0.0:
		l = 1.0
	steer_x = vx / l
	steer_z = vz / l
	return true

## v0.34.11 : comme steer, mais seulement vers une case voisine (8 voisins, sans coin coupé) : le zombie suit le champ case par case
## (un zombie bloqué contre un coin : la visée lointaine de steer frôle le coin, la case voisine le contourne). Résultat dans steer_x, steer_z.
func steer_local(x: float, z: float) -> bool:
	var ix := cx(x)
	var iz := cz(z)
	if not inside(ix, iz):
		return false
	var w := nx
	var best := dist[iz * w + ix]
	var bx := ix
	var bz := iz
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var jx := ix + dx
			var jz := iz + dz
			if jx < 0 or jz < 0 or jx >= w or jz >= nz:
				continue
			if dx != 0 and dz != 0 and (blocked[iz * w + jx] != 0 or blocked[jz * w + ix] != 0):
				continue
			var d := dist[jz * w + jx]
			if d < best:
				best = d
				bx = jx
				bz = jz
	if best >= INF_D or (bx == ix and bz == iz):
		return false
	var vx := world_x(bx) - x
	var vz := world_z(bz) - z
	var l := sqrt(vx * vx + vz * vz)
	if l < 1e-6:
		return false
	steer_x = vx / l
	steer_z = vz / l
	return true

## v0.34.11 : sortie d'un obstacle : direction vers le centre de la case libre et atteinte par le champ la plus proche, à moins de r cases
## (un zombie poussé au fond de la marge d'un mur ou d'un meuble, là où steer ne voit aucune voisine utile). Résultat dans steer_x, steer_z.
func escape(x: float, z: float, r: int) -> bool:
	var ix := cx(x)
	var iz := cz(z)
	if inside(ix, iz) and blocked[iz * nx + ix] == 0:
		return false   # sur une case libre : rien à fuir (sans champ ici, il est perdu, pas coincé)
	var best_d := INF
	var bx := -1
	var bz := -1
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			var jx := ix + dx
			var jz := iz + dz
			if not inside(jx, jz):
				continue
			var j := jz * nx + jx
			if blocked[j] != 0 or dist[j] >= INF_D:
				continue
			var ddx := world_x(jx) - x
			var ddz := world_z(jz) - z
			var d2 := ddx * ddx + ddz * ddz
			if d2 < best_d:
				best_d = d2
				bx = jx
				bz = jz
	if bx < 0 or best_d < 1e-6:
		return false
	var l := sqrt(best_d)
	steer_x = (world_x(bx) - x) / l
	steer_z = (world_z(bz) - z) / l
	return true

## Parcours en largeur de test (8 voisins, sans coin coupé) : chemin de cases du départ au but, vide si inaccessible.
func bfs(from: int, to: int) -> PackedInt32Array:
	var prev := PackedInt32Array()
	prev.resize(nx * nz)
	prev.fill(-1)
	var q := PackedInt32Array([from])
	prev[from] = from
	var h := 0
	while h < q.size():
		var i := q[h]
		h += 1
		if i == to:
			break
		var ix := i % nx
		var iz := i / nx
		for dz in range(-1, 2):
			for dx in range(-1, 2):
				if dx == 0 and dz == 0:
					continue
				var jx := ix + dx
				var jz := iz + dz
				if not inside(jx, jz):
					continue
				var j := jz * nx + jx
				if blocked[j] != 0 or prev[j] != -1:
					continue
				if dx != 0 and dz != 0 and (blocked[iz * nx + jx] != 0 or blocked[jz * nx + ix] != 0):
					continue
				prev[j] = i
				q.append(j)
	var path := PackedInt32Array()
	if prev[to] == -1:
		return path
	var c := to
	while c != from:
		path.append(c)
		c = prev[c]
	path.append(from)
	path.reverse()
	return path
