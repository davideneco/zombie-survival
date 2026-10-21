class_name DayNight
extends RefCounted
## v0.25.0 : cycle jour / nuit (propre au port Godot, absent du JS : le jeu y était toujours de nuit, hors la finale « L'Aube »). Pur : aucune scène ici ; graphics_view.gd
## lit `sky_k`, `sun_dir()`, `moon_dir()`, `lamps()` et les met en forme (ciel, brouillard, lumière, lampadaires, fenêtres).
##
## Heure du jeu : `hour` (0..24), qui avance de 24 h en `day_minutes` minutes réelles (défaut 14). Soleil : lever à 6 h, coucher à 18 h (équinoxe), 58 degrés de hauteur
## à midi, azimut 20 degrés au lever (la direction où se lève le soleil de l'Aube) puis 180 degrés de plus au coucher ; la lune est à l'opposé du soleil (pleine lune).
## `sky_k` : le même 0..1 que le ciel de l'Aube (0 nuit, 0,5 aube dorée, 1 plein jour) tiré de la hauteur du soleil, de sorte que le ciel, le brouillard et
## l'ambiance de la finale servent tels quels pour l'aube et le crépuscule.
##
## Réglage : Options > « Cycle jour / nuit » : Auto (le cycle tourne), Toujours nuit (l'ancien jeu : minuit, lune fixe, rien ne change), Toujours jour (10 h).
## Équilibrage (CONFIG ci-dessous, aussi lisible par Config.at("dayNight.…")) : en Auto seulement, la nuit (soleil sous l'horizon) les zombies ont 10 % de vie en plus
## à leur apparition ; le jour ne donne rien. En Toujours nuit / Toujours jour, aucun changement d'équilibrage (l'ancien équilibre = Toujours nuit sans le bonus).
## La finale « L'Aube » garde la main sur le ciel tant qu'elle est en cours (`override`), puis la Nuit éternelle fige la nuit en Auto.

const MODE_AUTO := 0
const MODE_NIGHT := 1
const MODE_DAY := 2
const MODE_NAMES := ["Auto", "Toujours nuit", "Toujours jour"]

const CONFIG := {
	"dayMinutes": 14.0,          ## minutes réelles pour 24 h de jeu
	"startHour": 9.0,            ## heure au début d'une partie (Auto)
	"sunrise": 6.0,
	"sunset": 18.0,
	"sunMaxElev": 58.0,          ## degrés au zénith (midi)
	"sunAzimuthRise": 20.0,      ## degrés (repère x, z de la scène) au lever ; +180 au coucher
	"fixedDayHour": 10.0,        ## heure de « Toujours jour »
	"fixedNightHour": 0.0,       ## heure de « Toujours nuit »
	"nightZombieHealth": 1.10,   ## x vie des zombies qui apparaissent la nuit (Auto)
	"nightBelowK": 0.3,          ## il fait nuit quand sky_k est sous cette valeur (soleil sous l'horizon)
	"easeRate": 0.35,            ## variation maximale de sky_k par seconde (changement de mode, finale)
	"lampOnK": 0.25,             ## lampadaires et fenêtres : allumés à fond sous ce sky_k, éteints au-dessus de lampOffK
	"lampOffK": 0.60,
	"clockMinutes": 15.0,        ## l'heure du HUD avance par pas de 15 minutes de jeu
}

var mode := MODE_NIGHT          ## le jeu pose le réglage du joueur (configure) ; les tests gardent la nuit d'avant
var day_minutes := 14.0
var hour := 0.0                 ## heure courante (0..24)
var sky_k := 0.0                ## ciel affiché (0 nuit .. 1 jour), rattrapé à `easeRate` par seconde
var override := false           ## la finale « L'Aube » dessine le ciel : l'heure est ignorée, la lumière suit l'ancien réglage (graphics_view.gd)
var frozen := false             ## l'heure ne bouge plus (captures : --hold-hour)
var days := 0                   ## jours complets écoulés depuis le début de la partie

static func cfg(key: String) -> float:
	return float(CONFIG[key])

func _init() -> void:
	reset(MODE_NIGHT, 14.0)

## Début de partie : mode et durée du jour du réglage du joueur ; l'heure de départ est celle du mode.
func reset(mode_: int, day_minutes_: float) -> void:
	days = 0
	override = false
	configure(mode_, day_minutes_)
	hour = start_hour_for(mode)
	sky_k = sky_k_at(hour)

func configure(mode_: int, day_minutes_: float) -> void:
	mode = clampi(mode_, MODE_AUTO, MODE_DAY)
	day_minutes = clampf(day_minutes_, 2.0, 120.0)
	if mode != MODE_AUTO:
		hour = start_hour_for(mode)

static func start_hour_for(m: int) -> float:
	match m:
		MODE_NIGHT:
			return cfg("fixedNightHour")
		MODE_DAY:
			return cfg("fixedDayHour")
	return cfg("startHour")

# ---------------------------------------------------------------- astronomie
## Hauteur du soleil (degrés) à l'heure h : sinusoïde de 6 h à 18 h (négative la nuit).
static func sun_elevation(h: float) -> float:
	var rise := cfg("sunrise")
	var span := cfg("sunset") - rise
	return cfg("sunMaxElev") * sin(PI * (h - rise) / span)

## Azimut du soleil (degrés) : 20 au lever, +180 au coucher, et il continue de tourner la nuit (la lune est à l'opposé).
static func sun_azimuth(h: float) -> float:
	var rise := cfg("sunrise")
	var span := cfg("sunset") - rise
	return cfg("sunAzimuthRise") + 180.0 * (h - rise) / span

static func dir_of(elev_deg: float, az_deg: float) -> Vector3:
	var el := deg_to_rad(elev_deg)
	var az := deg_to_rad(az_deg)
	return Vector3(cos(el) * cos(az), sin(el), cos(el) * sin(az))

## Direction (unitaire, de la scène vers l'astre) du soleil, de la lune.
static func sun_dir(h: float) -> Vector3:
	return dir_of(sun_elevation(h), sun_azimuth(h))

static func moon_dir(h: float) -> Vector3:
	return -sun_dir(h)

## sky_k d'une heure : -8 degrés et moins 0 (nuit), 5 degrés 0,5 (aube dorée), 35 degrés et plus 1 (plein jour).
static func sky_k_at(h: float) -> float:
	return k_of_elevation(sun_elevation(h))

static func k_of_elevation(e: float) -> float:
	if e <= -8.0:
		return 0.0
	if e < 5.0:
		return 0.5 * (e + 8.0) / 13.0
	if e < 35.0:
		return 0.5 + 0.5 * (e - 5.0) / 30.0
	return 1.0

## Lampadaires et fenêtres : 1 allumés, 0 éteints, selon sky_k (même courbe à l'aube et au crépuscule).
static func lamps_of(k: float) -> float:
	var t := clampf((k - cfg("lampOnK")) / (cfg("lampOffK") - cfg("lampOnK")), 0.0, 1.0)
	return 1.0 - t * t * (3.0 - 2.0 * t)

func lamps() -> float:
	return lamps_of(sky_k)

func is_night() -> bool:
	return sky_k < cfg("nightBelowK")

## Vie des zombies à leur apparition : +10 % la nuit, en Auto seulement.
func zombie_health_mult() -> float:
	return cfg("nightZombieHealth") if mode == MODE_AUTO and not override and is_night() else 1.0

# ---------------------------------------------------------------- pas
## Un pas de dt secondes. finale_k : le ciel de la finale (< 0 : la finale ne dessine pas le ciel) ; eternal : Nuit éternelle (après la finale).
func update(dt: float, finale_k: float, eternal: bool) -> void:
	override = finale_k >= 0.0
	var target := finale_k
	if not override:
		if mode == MODE_AUTO:
			if eternal:
				hour = cfg("fixedNightHour")   # Nuit éternelle : la nuit retombe pour de bon
			elif not frozen:
				hour += 24.0 * dt / (day_minutes * 60.0)
				if hour >= 24.0:
					hour = fposmod(hour, 24.0)
					days += 1
		else:
			hour = start_hour_for(mode)
		target = sky_k_at(hour)
	var step := cfg("easeRate") * dt
	sky_k = move_toward(sky_k, target, step)

## Heure du HUD : « HH:MM » par pas de clockMinutes.
func clock_text() -> String:
	var minutes := int(floor(hour * 60.0 / cfg("clockMinutes"))) * int(cfg("clockMinutes"))
	return "%02d:%02d" % [(minutes / 60) % 24, minutes % 60]

## Moment de la journée affiché à côté de l'heure.
func phase_name() -> String:
	if sky_k < 0.12:
		return "NUIT"
	if sky_k < 0.7:
		return "AUBE" if hour < 12.0 else "CRÉPUSCULE"
	return "JOUR"

## Le HUD montre l'horloge en Auto seulement (les deux autres modes sont figés).
func clock_visible() -> bool:
	return mode == MODE_AUTO and not override

# ---------------------------------------------------------------- partie sauvegardée
func to_dict() -> Dictionary:
	return {"hour": hour, "days": days, "mode": mode, "dayMinutes": day_minutes}

## Relit l'heure d'une partie (le mode et la durée du jour restent ceux des réglages du joueur si `keep_settings`).
func from_dict(d: Dictionary, keep_settings := true) -> void:
	if not keep_settings:
		configure(int(d.get("mode", mode)), float(d.get("dayMinutes", day_minutes)))
	hour = fposmod(float(d.get("hour", hour)), 24.0)
	days = int(d.get("days", days))
	sky_k = sky_k_at(hour)
