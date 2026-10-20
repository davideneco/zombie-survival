class_name Keybinds
extends RefCounted
## Liaisons de touches (port de src/keybinds.js). Une liaison est une chaîne : "code:KeyW" = touche PHYSIQUE (ZQSD en AZERTY = WASD en QWERTY)
## ou "key:r" = LETTRE TAPÉE (R, E, F, G, M, V, K marchent quel que soit le clavier). Les actions, leurs défauts, leur `kind` ('code' : toujours
## physique ; 'key' : la lettre tapée si c'est une lettre, sinon la touche physique) et leur contexte ('all', 'foot', 'moto') viennent de
## CONFIG.keybinds. Les codes sont ceux du web (KeyW, Digit1, ShiftLeft…) pour que les défauts de CONFIG et les golden JS servent tels quels.
## Sans nœud : les événements sont des InputEventKey ; `apply_to_input_map` recopie les liaisons dans l'InputMap (actions de main.gd).

signal changed

## action de liaison -> action de l'InputMap lue par main.gd
const PORT_RESERVED := {"F3": "F3 affiche le compteur de FPS"}   ## touches réservées propres au port Godot (le JS n'a pas de compteur) ; `reserved()` ajoute celles de config.json

## Raison du refus d'une touche (null si libre) : réservées du JS (config.json) puis du port.
static func reserved(code: String) -> Variant:
	var why: Variant = Config.at("reservedKeys.%s" % code)
	return why if why != null else PORT_RESERVED.get(code)

const ACTIONS := {
	"forward": "move_forward", "left": "move_left", "back": "move_back", "right": "move_right", "sprint": "sprint", "jump": "jump",
	"reload": "reload", "weapon1": "weapon_1", "weapon2": "weapon_2", "weapon3": "weapon_3", "grenade": "grenade", "knife": "knife",
	"torch": "torch", "interact": "use", "map": "map", "vehicleView": "vehicle_view", "tramGong": "tram_gong", "tramDoors": "tram_doors",
	"tramSwitch": "tram_switch", "unstick": "unstick", "chat": "chat",
}

## code web -> touche physique Godot
static var _code_to_key: Dictionary = {}
static var _key_to_code: Dictionary = {}

const NAMES := {
	"Space": "Espace", "ShiftLeft": "Maj gauche", "ShiftRight": "Maj droite", "ControlLeft": "Ctrl gauche", "ControlRight": "Ctrl droite",
	"AltLeft": "Alt", "AltRight": "Alt Gr", "Enter": "Entrée", "Backspace": "Retour arrière", "Tab": "Tab", "CapsLock": "Verr. maj",
	"ArrowUp": "↑", "ArrowDown": "↓", "ArrowLeft": "←", "ArrowRight": "→", "Insert": "Inser", "Delete": "Suppr", "Home": "Début", "End": "Fin",
	"PageUp": "Page ↑", "PageDown": "Page ↓", "NumLock": "Verr. num", "ScrollLock": "Arrêt défil", "Pause": "Pause", "PrintScreen": "Impr. écran",
	"NumpadAdd": "Pavé +", "NumpadSubtract": "Pavé -", "NumpadMultiply": "Pavé *", "NumpadDivide": "Pavé /", "NumpadDecimal": "Pavé .", "NumpadEnter": "Pavé Entrée",
}
const PUNCT := {"Backquote": "`", "Minus": "-", "Equal": "=", "BracketLeft": "[", "BracketRight": "]", "Backslash": "\\", "Semicolon": ";", "Quote": "'",
	"Comma": ",", "Period": ".", "Slash": "/", "IntlBackslash": "<"}

var defs: Array = []              ## CONFIG.keybinds
var by_id: Dictionary = {}
var map: Dictionary = {}          ## action -> liaison
var _parsed: Dictionary = {}      ## action -> { t, v }
var _codes: Dictionary = {}       ## touches physiques liées (les flèches de secours se coupent si une action les utilise)
var layout_names := true          ## noms de touches d'après la disposition du clavier (DisplayServer) ; faux : noms QWERTY (tests)

func _init() -> void:
	_build_tables()
	defs = Config.at("keybinds", [])
	for d: Dictionary in defs:
		by_id[d["id"]] = d
	reset_all(false)

static func _build_tables() -> void:
	if not _code_to_key.is_empty():
		return
	for i in 26:
		_code_to_key["Key" + String.chr(65 + i)] = KEY_A + i
	for i in 10:
		_code_to_key["Digit%d" % i] = KEY_0 + i
		_code_to_key["Numpad%d" % i] = KEY_KP_0 + i
	for i in 12:
		_code_to_key["F%d" % (i + 1)] = KEY_F1 + i
	var more := {
		"Space": KEY_SPACE, "ShiftLeft": KEY_SHIFT, "ShiftRight": KEY_SHIFT, "ControlLeft": KEY_CTRL, "ControlRight": KEY_CTRL, "AltLeft": KEY_ALT,
		"AltRight": KEY_ALT, "Enter": KEY_ENTER, "Backspace": KEY_BACKSPACE, "Tab": KEY_TAB, "CapsLock": KEY_CAPSLOCK, "ArrowUp": KEY_UP,
		"ArrowDown": KEY_DOWN, "ArrowLeft": KEY_LEFT, "ArrowRight": KEY_RIGHT, "Insert": KEY_INSERT, "Delete": KEY_DELETE, "Home": KEY_HOME,
		"End": KEY_END, "PageUp": KEY_PAGEUP, "PageDown": KEY_PAGEDOWN, "NumLock": KEY_NUMLOCK, "ScrollLock": KEY_SCROLLLOCK, "Pause": KEY_PAUSE,
		"PrintScreen": KEY_PRINT, "Escape": KEY_ESCAPE, "NumpadAdd": KEY_KP_ADD, "NumpadSubtract": KEY_KP_SUBTRACT, "NumpadMultiply": KEY_KP_MULTIPLY,
		"NumpadDivide": KEY_KP_DIVIDE, "NumpadDecimal": KEY_KP_PERIOD, "NumpadEnter": KEY_KP_ENTER, "Backquote": KEY_QUOTELEFT, "Minus": KEY_MINUS,
		"Equal": KEY_EQUAL, "BracketLeft": KEY_BRACKETLEFT, "BracketRight": KEY_BRACKETRIGHT, "Backslash": KEY_BACKSLASH, "Semicolon": KEY_SEMICOLON,
		"Quote": KEY_APOSTROPHE, "Comma": KEY_COMMA, "Period": KEY_PERIOD, "Slash": KEY_SLASH, "IntlBackslash": KEY_LESS, "MetaLeft": KEY_META,
		"MetaRight": KEY_META, "ContextMenu": KEY_MENU,
	}
	_code_to_key.merge(more, true)
	for code: String in _code_to_key:
		var k: int = _code_to_key[code]
		if not _key_to_code.has(k):
			_key_to_code[k] = code   # le premier gagne : ShiftLeft avant ShiftRight, etc.

# ---------------------------------------------------------------- événements <-> codes
static func key_of_code(code: String) -> int:
	_build_tables()
	return int(_code_to_key.get(code, KEY_NONE))

## Code web de la touche physique d'un événement ("" si inconnue).
static func code_of(e: InputEventKey) -> String:
	_build_tables()
	var k := int(e.physical_keycode) if e.physical_keycode != KEY_NONE else int(e.keycode)
	if k == KEY_SHIFT and e.location == KEY_LOCATION_RIGHT:
		return "ShiftRight"
	if k == KEY_CTRL and e.location == KEY_LOCATION_RIGHT:
		return "ControlRight"
	if k == KEY_ALT and e.location == KEY_LOCATION_RIGHT:
		return "AltRight"
	return String(_key_to_code.get(k, ""))

## Lettre réellement tapée (minuscule), "" pour une touche non imprimable (typedLetter du JS).
static func typed_letter(e: InputEventKey) -> String:
	if e.unicode > 0:
		return String.chr(e.unicode).to_lower()
	var k := int(e.keycode)
	if k >= KEY_A and k <= KEY_Z:
		return String.chr(k + 32)
	return ""

static func is_letter(s: String) -> bool:
	return s.length() == 1 and s.to_upper() != s.to_lower()

static func parse(s: String) -> Dictionary:
	var i := s.find(":")
	if i < 0 or not (s.begins_with("code:") or s.begins_with("key:")):
		return {}
	return {"t": s.substr(0, i), "v": s.substr(i + 1)}

# ---------------------------------------------------------------- lecture des entrées
func _refresh() -> void:
	_codes.clear()
	for d: Dictionary in defs:
		_parsed[d["id"]] = parse(String(map[d["id"]]))
		if _parsed[d["id"]]["t"] == "code":
			_codes[_parsed[d["id"]]["v"]] = true

## Cet événement est-il la liaison de l'action ? (appui)
func is_event(id: String, e: InputEventKey) -> bool:
	var p: Dictionary = _parsed[id]
	if p["t"] == "code":
		return code_of(e) == p["v"]
	return typed_letter(e) == p["v"]

## Une des liaisons recoupe-t-elle cet événement ?
func is_bound(e: InputEventKey) -> bool:
	for d: Dictionary in defs:
		if is_event(d["id"], e):
			return true
	return false

# ---------------------------------------------------------------- noms de touches
func code_name(code: String) -> String:
	if code.begins_with("Digit"):
		return code.substr(5)
	if code.begins_with("Numpad") and code.length() == 7:
		return "Pavé " + code.substr(6)
	if NAMES.has(code):
		return NAMES[code]
	if layout_names and DisplayServer.get_name() != "headless" and code.begins_with("Key"):
		var phys := key_of_code(code)
		if phys != KEY_NONE:
			var lay: Key = DisplayServer.keyboard_get_keycode_from_physical(phys as Key)
			var s := OS.get_keycode_string(lay)
			if s != "":
				return s.to_upper()
	if PUNCT.has(code):
		return PUNCT[code]
	if code.begins_with("Key") and code.length() == 4:
		return code.substr(3)
	return code

func name_of(binding: String) -> String:
	var p := parse(binding)
	if p.is_empty():
		return "?"
	return String(p["v"]).to_upper() if p["t"] == "key" else code_name(p["v"])

func label(id: String) -> String:
	return name_of(map[id])

func tag(id: String) -> String:
	return "[%s]" % label(id)

## « ZQSD » (ou « WASD ») : les quatre touches de déplacement, séparées par un espace si l'une d'elles a un nom long.
func move_label() -> String:
	var l: PackedStringArray = []
	for id in ["forward", "left", "back", "right"]:
		l.append(label(id))
	var short := true
	for s in l:
		short = short and s.length() == 1
	return "".join(l) if short else " ".join(l)

# ---------------------------------------------------------------- modification
func get_binding(id: String) -> String:
	return map[id]

func is_default(id: String) -> bool:
	return map[id] == by_id[id]["def"]

func any_changed() -> bool:
	for d: Dictionary in defs:
		if map[d["id"]] != d["def"]:
			return true
	return false

## Liaison déduite d'un appui : { binding, code, letter } ou { error }.
func from_event(id: String, e: InputEventKey) -> Dictionary:
	var code := code_of(e)
	if code == "":
		return {"error": "Touche non reconnue."}
	var why: Variant = reserved(code)
	if why != null:
		return {"error": "Touche refusée : %s." % why}
	var l := typed_letter(e)
	var binding := ("key:" + l) if (by_id[id]["kind"] == "key" and is_letter(l)) else ("code:" + code)
	return {"binding": binding, "code": code, "letter": l}

static func _overlap(a: String, b: String) -> bool:
	return a == "all" or b == "all" or a == b

## Actions (hors id et ignore) dont le contexte recoupe celui de l'action et qui utilisent déjà cette touche. ev : { code, letter } ou {}.
func conflicts(id: String, binding: String, ev: Dictionary = {}, ignore: Array = []) -> Array:
	var p := parse(binding)
	var out: Array = []
	for d: Dictionary in defs:
		var did: String = d["id"]
		if did == id or ignore.has(did) or not _overlap(String(d["ctx"]), String(by_id[id]["ctx"])):
			continue
		var o: Dictionary = _parsed[did]
		var same: bool = o["t"] == p["t"] and o["v"] == p["v"]
		if not same and not ev.is_empty():
			same = (o["v"] == ev["code"]) if o["t"] == "code" else (o["v"] == ev["letter"])
		if same:
			out.append(did)
	return out

func set_binding(id: String, binding: String, save_it := true) -> void:
	map[id] = binding
	_refresh()
	if save_it:
		changed.emit()

## other reçoit l'ancienne liaison de id. Faux si cela créerait un nouveau conflit.
func swap(id: String, binding: String, other: String) -> bool:
	var old: String = map[id]
	if not conflicts(other, old, {}, [id, other]).is_empty():
		return false
	map[id] = binding
	map[other] = old
	_refresh()
	changed.emit()
	return true

func reset(id: String) -> void:
	set_binding(id, by_id[id]["def"])

func reset_all(notify := true) -> void:
	for d: Dictionary in defs:
		map[d["id"]] = d["def"]
	_refresh()
	if notify:
		changed.emit()

## Les flèches de secours (alt) sont actives tant qu'aucune action ne les utilise.
func alt_active(id: String) -> bool:
	var alt: String = String(by_id[id].get("alt", ""))
	return alt != "" and not _codes.has(alt)

# ---------------------------------------------------------------- sauvegarde (ConfigFile, section [keys])
func save_to(cf: ConfigFile) -> void:
	if cf.has_section("keys"):
		cf.erase_section("keys")
	for d: Dictionary in defs:
		if map[d["id"]] != d["def"]:
			cf.set_value("keys", d["id"], map[d["id"]])

func load_from(cf: ConfigFile) -> void:
	reset_all(false)
	for d: Dictionary in defs:
		var id: String = d["id"]
		var s := String(cf.get_value("keys", id, ""))
		var p := parse(s)
		if p.is_empty() or (p["t"] == "code" and reserved(p["v"]) != null):
			continue
		var prev: String = map[id]
		map[id] = s
		_refresh()
		if not conflicts(id, s).is_empty():   # sauvegarde incohérente : on garde le défaut
			map[id] = prev
			_refresh()

# ---------------------------------------------------------------- InputMap
## Recopie les liaisons dans l'InputMap : une action par entrée de ACTIONS. Une liaison "key:x" devient un événement à `keycode` (lettre
## tapée), une liaison "code:X" un événement à `physical_keycode`.
func apply_to_input_map() -> void:
	for id: String in ACTIONS:
		if not by_id.has(id):
			continue
		var action: String = ACTIONS[id]
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		InputMap.action_erase_events(action)
		var p: Dictionary = _parsed[id]
		var ev := InputEventKey.new()
		if p["t"] == "code":
			ev.physical_keycode = key_of_code(p["v"]) as Key
		else:
			var kc := OS.find_keycode_from_string(String(p["v"]).to_upper())
			ev.keycode = kc
		InputMap.action_add_event(action, ev)
		if alt_active(id):
			var ae := InputEventKey.new()
			ae.physical_keycode = key_of_code(String(by_id[id]["alt"])) as Key
			InputMap.action_add_event(action, ae)
