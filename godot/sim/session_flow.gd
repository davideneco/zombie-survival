class_name SessionFlow
extends RefCounted
## Machine d'états de la session (menu principal <-> chargement <-> partie), pure et testable. main.gd l'exécute.
##   MENU     aucune partie en mémoire (Game.world, joueur et zombies nuls) : le menu s'ouvre sans rien charger.
##   LOADING  chargement par étapes après NOUVELLE PARTIE (l'interface reste vivante).
##   PLAYING  partie en cours (ou en pause).
##   ENDED    partie terminée (équipe éliminée) : l'écran de fin est ouvert, la partie est encore en mémoire.
## Transitions : MENU/ENDED/PLAYING -> LOADING (nouvelle partie, rejouer) -> PLAYING ; PLAYING -> ENDED ; tout sauf LOADING -> MENU.
## `recorded` garantit qu'une partie n'est comptée qu'une fois dans les statistiques.

enum { MENU, LOADING, PLAYING, ENDED }

## Étapes du chargement : [clé, texte, poids]. Le poids sert à la barre de progression.
const STEPS := [
	["data", "Lecture de la carte", 0.34],
	["game", "Préparation de la partie", 0.06],
	["scene", "Construction de la ville", 0.25],
	["views", "Lumières, ciel et effets", 0.10],
	["warm", "Préchauffage des effets", 0.20],
	["final", "Dernières vérifications", 0.05],
]

var state := MENU
var recorded := true      ## faux dès qu'une partie démarre, vrai une fois ses statistiques enregistrées
var step := -1

func is_menu() -> bool:
	return state == MENU

func in_game() -> bool:
	return state == PLAYING or state == ENDED

func can_start() -> bool:
	return state != LOADING

func start_loading() -> bool:
	if state == LOADING:
		return false
	state = LOADING
	step = 0
	recorded = false
	return true

func next_step() -> void:
	step = mini(step + 1, STEPS.size() - 1)

## Progression 0..1 : étape courante + part `frac` (0..1) de cette étape.
func progress(frac := 0.0) -> float:
	if state != LOADING:
		return 1.0 if state != MENU else 0.0
	var done := 0.0
	for i in step:
		done += float(STEPS[i][2])
	return clampf(done + float(STEPS[maxi(step, 0)][2]) * clampf(frac, 0.0, 1.0), 0.0, 1.0)

func step_text() -> String:
	return String(STEPS[maxi(step, 0)][1]) if state == LOADING else ""

func finish_loading() -> bool:
	if state != LOADING:
		return false
	state = PLAYING
	step = -1
	return true

func end_game() -> bool:
	if state != PLAYING:
		return false
	state = ENDED
	return true

func to_menu() -> bool:
	if state == LOADING:
		return false
	state = MENU
	return true

## Doit-on enregistrer les statistiques maintenant ? (une fois par partie)
func needs_record() -> bool:
	return in_game() and not recorded

func mark_recorded() -> void:
	recorded = true
