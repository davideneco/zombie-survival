class_name FpsWindow
extends RefCounted
## v0.20.5 compteur de FPS : fenêtre glissante des dernières WINDOW secondes de durées d'image (anneau de flottants, aucune allocation par image),
## plus min / max depuis le début de la partie. Pur : aucun nœud. Le MIN / MAX d'une fenêtre se calcule à la demande (`refresh`, ~4 fois par seconde), pas à chaque image.
## Ignorés : les images où le jeu n'est pas actif (chargement, pause, menus : `feed(dt, false)`) et les SKIP images qui suivent chaque reprise (pic de reprise).

const WINDOW := 10.0   ## secondes
const SKIP := 3        ## images ignorées après chaque (re)prise...
const SKIP_TIME := 0.5 ## ...et au moins ce temps (s) : les pics de reprise / de premier affichage ne comptent pas
const CAP := 4096      ## taille de l'anneau (10 s à 400 images/s ; au-delà les plus anciennes sont poussées dehors)

var _dts := PackedFloat32Array()
var _head := 0         ## indice de la plus ancienne mesure
var _count := 0
var _sum := 0.0        ## somme des durées de l'anneau
var _skip := SKIP
var _skip_t := SKIP_TIME
var _last := 0.0

var current := 0.0     ## FPS de la dernière image mesurée
var average := 0.0     ## images / secondes sur la fenêtre
var win_min := 0.0     ## FPS de la plus longue image de la fenêtre
var win_max := 0.0     ## FPS de la plus courte image de la fenêtre
var all_min := 0.0     ## depuis le début de la partie (0 tant que rien n'est mesuré)
var all_max := 0.0
var frames := 0        ## images mesurées depuis la dernière remise à zéro

func _init() -> void:
	_dts.resize(CAP)

## Nouvelle partie : tout à zéro.
func reset() -> void:
	_head = 0
	_count = 0
	_sum = 0.0
	_skip = SKIP
	_skip_t = SKIP_TIME
	_last = 0.0
	current = 0.0
	average = 0.0
	win_min = 0.0
	win_max = 0.0
	all_min = 0.0
	all_max = 0.0
	frames = 0

## Une image de durée dt (s). active = false : chargement, pause ou menu : rien n'est mesuré, et les SKIP images de la reprise ne le sont pas non plus.
func feed(dt: float, active: bool) -> void:
	if not active or dt <= 0.0:
		_skip = SKIP
		_skip_t = SKIP_TIME
		return
	if _skip > 0 or _skip_t > 0.0:
		_skip = maxi(0, _skip - 1)
		_skip_t -= dt
		return
	if _count == CAP:   # anneau plein : la plus ancienne sort
		_sum -= _dts[_head]
		_head = (_head + 1) % CAP
		_count -= 1
	_dts[(_head + _count) % CAP] = dt
	_count += 1
	_sum += dt
	while _sum > WINDOW and _count > 1:
		_sum -= _dts[_head]
		_head = (_head + 1) % CAP
		_count -= 1
	frames += 1
	_last = dt
	current = 1.0 / dt
	var f := current
	if all_min == 0.0 or f < all_min:
		all_min = f
	if f > all_max:
		all_max = f

## Recalcule moyenne, min et max de la fenêtre (parcours de l'anneau : à appeler quelques fois par seconde).
func refresh() -> void:
	if _count == 0:
		average = 0.0
		win_min = 0.0
		win_max = 0.0
		return
	var mx := 0.0
	var mn := INF
	for i in _count:
		var d := _dts[(_head + i) % CAP]
		mx = maxf(mx, d)
		mn = minf(mn, d)
	average = float(_count) / maxf(_sum, 1e-9)
	win_min = 1.0 / mx
	win_max = 1.0 / mn

func window_frames() -> int:
	return _count
