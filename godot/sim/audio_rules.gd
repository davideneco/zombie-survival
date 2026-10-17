class_name AudioRules
extends RefCounted
## J8 : règles du son, sans nœud ni lecteur (testables en headless). Les constantes qui ne sont pas dans CONFIG viennent de src/audio.js et src/music.js
## (chacune avec sa source) ; tools/export-golden-j8.mjs les relit en exécutant le vrai code JS (data/golden/j8.json).

## --- volumes
const MIN_VOL := 0.03                 ## audio.js : la plupart des sons ignorent v < 0.03
const MIN_GROAN := 0.01               ## audio.js groan : volume <= 0.01 ignoré
const BUS_GAIN := 0.6                 ## audio.js _build : this.bus.gain
const VERB_OUT := 0.55                ## audio.js _build : verbOut.gain
const LIMITER_CEILING_DB := -3.0      ## audio.js _build : limiter.threshold
const COMP_THRESHOLD_DB := -14.0      ## comp.threshold (knee 12 : pas d'équivalent Godot)
const COMP_RATIO := 5.0
const COMP_ATTACK_US := 3000.0        ## comp.attack 0,003 s
const COMP_RELEASE_MS := 200.0        ## comp.release 0,2 s
const MUFFLE_FREQ := 650.0            ## music.js setMuffled : filtre passe-bas fermé
const OPEN_FREQ := 20000.0
const MUFFLE_DUCK := 0.55             ## gain de la baisse de volume en menu / pause
const MUFFLE_TIME := 0.45             ## constantes de temps 0,15 s (filtre) et 0,2 s (volume) : ~3 constantes pour atteindre la cible
const FADE_TIME := 1.5                ## fondu enchaîné entre deux niveaux de musique (le JS change de rythme à la mesure suivante)

## --- distances (main.js, vehicles.js, tram.js)
const ZOMBIE_EVENT_RANGE := 45.0      ## onEvent : v = max(0, 1 - d / 45)
const GROAN_RANGE := 30.0             ## boucle des zombies : groan(max(0, 1 - d / 30))
const EXPLOSION_RANGE := 60.0         ## explode : max(0.1, 1 - d / 60)
const BURN_ALARM_RANGE := 60.0        ## vehicles.js : alarm(max(0, 1 - d / 60))
const ALARM_PERIOD := 0.42            ## vehicles.js : alarmT
const GROAN_FIRST := Vector2(2.0, 8.0)    ## zombie.js : groanT = 2 + random * 6
const GROAN_NEXT := Vector2(4.0, 10.0)    ## main.js : groanT = 4 + random * 6
const BRAKE_PERIOD := 0.1             ## tram.js appelle tramBrake à chaque image tant que `squeal` dure ; ici au plus 10 par seconde

## --- musique
const LEVEL_THRESHOLDS := [0.12, 0.45, 0.75]   ## music.js _beginBar
const BPM_BASE := 102.0
const BPM_SPAN := 34.0
const MOOD_BASE := 0.3                ## main.js updateMusicMood
const MOOD_PER_ROUND := 0.05
const MOOD_MAX := 0.85

## --- moteurs (audio.js createEngine, createTramEngine)
const MOTO_BASE := 52.0
const MOTO_SPAN := 175.0
const BIG_BASE := 34.0
const BIG_SPAN := 95.0
const TRAM_BASE := 38.0
const TRAM_SPAN := 70.0

## Volume linéaire du JS (gain de crête ajouté à un son) -> dB.
static func vol_db(v: float) -> float:
	return linear_to_db(maxf(v, 0.0001))

## Intensité de la musique : menu 0,3 ; partie : 0,3 + 0,05 x manche (au plus 0,85) ; finale 1 (main.js updateMusicMood).
static func mood_intensity(in_game: bool, finale: bool, round_number: int) -> float:
	if not in_game:
		return MOOD_BASE
	if finale:
		return 1.0
	return minf(MOOD_MAX, MOOD_BASE + round_number * MOOD_PER_ROUND)

## Niveau de rythme (0 calme, 1 rythmé, 2 dur, 3 à fond) : music.js _beginBar. L'accalmie entre deux manches vaut le niveau 0.
static func music_level(intensity: float, lull: bool) -> int:
	var x := 0.0 if lull else intensity
	if lull or x < LEVEL_THRESHOLDS[0]:
		return 0
	if x < LEVEL_THRESHOLDS[1]:
		return 1
	return 2 if x < LEVEL_THRESHOLDS[2] else 3

static func music_bpm(intensity: float, lull: bool) -> float:
	return BPM_BASE + BPM_SPAN * (0.0 if lull else intensity)

## Position dans la boucle suivante qui garde la même place musicale (16 mesures dans chaque niveau, tempos différents).
static func sync_position(pos: float, from_len: float, to_len: float) -> float:
	return fposmod(pos / maxf(from_len, 0.001), 1.0) * to_len

## Fréquence de la première oscillation du moteur (audio.js : base + rpm x span). kind : "moto", "grosseMoto" ou "tram" (rpm = vitesse 0..1).
static func engine_freq(kind: String, rpm: float) -> float:
	match kind:
		"grosseMoto":
			return BIG_BASE + rpm * BIG_SPAN
		"tram":
			return TRAM_BASE + rpm * TRAM_SPAN
	return MOTO_BASE + rpm * MOTO_SPAN

## Gain de sortie du moteur avant le volume (audio.js : out.gain.setTargetAtTime). throttle déjà ramené à >= 0 par l'appelant pour la rame.
static func engine_gain(kind: String, rpm: float, throttle: float, vol: float) -> float:
	if kind == "tram":
		return vol * (0.1 + 0.12 * rpm + throttle * 0.05)
	return vol * (0.16 + 0.1 * rpm + maxf(0.0, throttle) * 0.06)

## Régime d'une moto (vehicles.js updateEngine) : 4 rapports, le régime retombe à chaque passage.
static func moto_rpm(speed: float, max_speed: float, throttle: float) -> float:
	var ratio := clampf(absf(speed) / max_speed, 0.0, 1.0)
	var gears := 4
	var gear := mini(gears - 1, int(floor(ratio * gears)))
	return clampf(0.22 + 0.68 * (ratio * gears - gear) + maxf(0.0, throttle) * 0.08, 0.15, 1.0)

## Volume d'un moteur ou d'une rame entendus de loin (vehicles.js : clamp(1 - d / 55)^2 ; tram.js distVol : clamp(1 - d / maxD)^2).
static func far_vol(d: float, max_d: float) -> float:
	return pow(clampf(1.0 - d / max_d, 0.0, 1.0), 2.0)

## Volume linéaire d'un évènement lointain : max(0, 1 - d / portée).
static func near_vol(d: float, range_: float, floor_: float = 0.0) -> float:
	return maxf(floor_, 1.0 - d / range_)

## Défilement de la boîte mystère : hauteur du tic (audio.js tick : 700 + 500 p Hz, cuit à p = 0).
static func tick_pitch(p: float) -> float:
	return (700.0 + 500.0 * p) / 700.0

## Frein de la rame (audio.js tramBrake) : volume 0,22 x k et hauteur 3400 + 120 vitesse, cuit à la vitesse 14 (k = 1).
static func brake_k(speed: float) -> float:
	return minf(1.0, speed / 14.0)

static func brake_pitch(speed: float) -> float:
	return (3400.0 + speed * 120.0) / (3400.0 + 14.0 * 120.0)

## Pas de la boîte mystère (machineFx.js updateBoxRoll) : délai avant le tic suivant, p = avancement du tirage.
static func box_tick_delay(p: float) -> float:
	return 0.055 + 0.42 * p * p * p

## Pack-a-Punch (machineFx.js updatePap) : délai entre deux bouffées pendant l'amélioration, k = avancement.
static func pap_puff_delay(k: float) -> float:
	return 0.45 - 0.3 * k

## Son de rechargement d'une arme : la cuisson regroupe les armes de même (catégorie, durée) (tools/audio-list.mjs).
static func reload_name(cat: String, t: float) -> String:
	var s := str(int(t)) if t == floorf(t) else str(t)
	return "reload_%s_%s" % [cat, s.replace(".", "p")]

static func gun_name(id: String) -> String:
	return "gun_%s" % id
