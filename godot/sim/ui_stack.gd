class_name UiStack
extends RefCounted
## Pile des couches d'interface et comportement de la touche Échap (port de src/ui.js, sans le pointer lock du navigateur : Godot reçoit
## Échap même souris capturée, donc pas de couche « bandeau »). De la plus ancienne à la plus récente :
##   TITLE (titre), MENU (pseudo, personnage, Solo), OPTIONS, KEYS (Options > Touches), puis CAPTURE (« Appuyez sur une touche… ») ou
##   CONFLICT (touche déjà prise : échanger ?), PAUSE, OVER (équipe éliminée), VICTORY ; puis, par-dessus le jeu, MAP.
## `escape(in_game)` ferme la couche du dessus et dit quoi faire ; en jeu sans couche ouverte, Échap ouvre la pause. Les actions renvoyées :
## "cancel_capture", "back" (retour à la couche d'en dessous), "close_map", "resume", "pause", "continue" (victoire), "" (rien : titre, fin).

const TITLE := "title"
const MENU := "menu"
const OPTIONS := "options"
const KEYS := "keys"
const CAPTURE := "capture"
const CONFLICT := "conflict"
const PAUSE := "pause"
const OVER := "over"
const VICTORY := "victory"
const MAP := "map"

var layers: Array[String] = []

func top() -> String:
	return layers[layers.size() - 1] if not layers.is_empty() else ""

func has(name: String) -> bool:
	return layers.has(name)

func is_empty() -> bool:
	return layers.is_empty()

func push(name: String) -> void:
	if not layers.has(name):
		layers.append(name)

## Retire une couche (et toutes celles qui la recouvrent).
func close(name: String) -> void:
	var i := layers.find(name)
	if i >= 0:
		layers.resize(i)

func pop() -> String:
	return layers.pop_back() if not layers.is_empty() else ""

func clear() -> void:
	layers.clear()

## Remplace la couche du dessus.
func replace_top(name: String) -> void:
	if not layers.is_empty():
		layers.pop_back()
	push(name)

## Couche « pleine » (menu ou écran) : le jeu n'est pas jouable. La carte, elle, laisse le jeu tourner.
func blocks_game() -> bool:
	for l in layers:
		if l != MAP:
			return true
	return false

## Échap : ferme la couche du dessus ; renvoie l'action à exécuter.
func escape(in_game: bool) -> String:
	match top():
		CAPTURE, CONFLICT:
			pop()
			return "cancel_capture"
		KEYS, OPTIONS, MENU:
			pop()
			return "back"
		MAP:
			pop()
			return "close_map"
		PAUSE:
			pop()
			return "resume"
		VICTORY:
			pop()
			return "continue"
		TITLE, OVER:
			return ""
		_:
			if in_game:
				push(PAUSE)
				return "pause"
	return ""
