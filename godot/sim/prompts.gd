class_name Prompts
extends RefCounted
## Invite contextuelle du bas de l'écran (bloc « Prompt contextuel » de src/main.js) : borne de munitions, machine, arme murale, puis ce que
## propose Rides (monter, pompe, sous-station, rame), puis la porte payante. `tag` donne le texte d'une touche (« [E] ») ; vide : aucune invite.

static func text(g: Node, binds: Keybinds = null) -> String:
	if g.player == null or g.over:
		return ""
	var k := binds.tag("interact") if binds != null else "[E]"
	var rides: Rides = g.rides
	if rides != null and rides.ride != null:
		return _keys(rides.prompt(), binds)
	if g.player.downed or g.player.dead:
		return ""
	var arms: WeaponArms = g.arms
	if g.unstick != null:   # coincé : l'invite de déblocage passe avant les autres (main.js : unstickPrompt)
		var up: String = g.unstick.prompt(binds.tag("unstick") if binds != null else "[K]")
		if up != "":
			return up
	if g.finale != null and g.finale.fanal_prompt() != "":   # le Fanal d'Erwin (Acte V)
		return _keys(g.finale.fanal_prompt(), binds)
	if WeaponShop.near_station(g):
		var w: WeaponState = arms.current
		if w.reserve >= int(w.cfg["maxReserve"]):
			return "Munitions au maximum"
		return "%s Munitions %s (%d pts)" % [k, w.cfg["name"], int(w.cfg["ammoPrice"])]
	if g.machines != null:
		var mp: String = g.machines.prompt()
		if mp != "":
			return _keys(mp, binds)
	var ww := WeaponShop.near_wall_weapon(g)
	if not ww.is_empty():
		for w: WeaponState in arms.inventory:
			if w.id == ww["id"]:
				if w.reserve >= int(w.cfg["maxReserve"]):
					return "%s (Munitions pleines)" % ww["name"]
				return "%s Munitions %s (%d pts)" % [k, ww["name"], roundi(float(ww["ammoPrice"]) * Pap.pap_ammo_mult(w.pap))]
		var full := arms.inventory.size() >= arms.max_weapons()
		return "%s Acheter %s (%d pts)%s" % [k, ww["name"], int(ww["price"]), " — remplace l’arme en main" if full else ""]
	if rides != null:
		var rp := rides.prompt()
		if rp != "":
			return _keys(rp, binds)
	if g.world != null:
		var id: int = g.world.near_door(g.player.pos)
		if id >= 0:
			var d: Dictionary = g.world.doors[id]
			var here: int = g.world.zone_of(g.player.pos.x, g.player.pos.z)
			var to: int = int(d["b"]) if here == int(d["a"]) else (int(d["a"]) if here == int(d["b"]) else int(d["toZone"]))
			return "%s Ouvrir la porte vers %s (%s)" % [k, g.world.zone_names[to], "gratuit" if g.free_doors else "%d pts" % int(d["price"])]
		if g.world.near_sealed(g.player.pos) >= 0:   # v0.26.0 : Zone unique
			return "Passage muré — seule la porte de sortie mène hors de la zone"
	if g.player.vault_ready and g.player.vault.is_empty():   # devant un obstacle bas
		return "%s Enjamber" % (binds.tag("jump") if binds != null else "[Espace]")
	return ""

## v0.28.0 : the same prompt, split for the HUD (icon, price in its own colour): { text (= text()), main (text without « (N pts) »), price (-1 : none),
## afford, kind (wall_buy, wall_ammo, wall_full, station, station_full, machine, door, other, ""), id (weapon id for the wall / station kinds), pap }.
static var _price_rx: RegEx

static func info(g: Node, binds: Keybinds = null) -> Dictionary:
	var txt := text(g, binds)
	var out := {"text": txt, "main": txt, "price": -1, "afford": true, "kind": "", "id": "", "pap": false}
	if txt == "":
		return out
	out["kind"] = "other"
	if _price_rx == null:
		_price_rx = RegEx.create_from_string("\\s*\\((\\d+) pts\\)")
	var m := _price_rx.search(txt)
	if m != null:
		out["price"] = int(m.get_string(1))
		out["main"] = txt.substr(0, m.get_start()) + txt.substr(m.get_end())
		out["afford"] = int(g.points) >= int(out["price"])
	var rides: Rides = g.rides
	if (rides != null and rides.ride != null) or g.player.downed or g.player.dead:
		return out
	var arms: WeaponArms = g.arms
	if WeaponShop.near_station(g):
		out["kind"] = "station" if int(out["price"]) >= 0 else "station_full"
		out["id"] = arms.current.id
		out["pap"] = arms.current.pap > 0
		return out
	if g.machines != null and g.machines.prompt() != "":
		out["kind"] = "machine"
		return out
	var ww := WeaponShop.near_wall_weapon(g)
	if not ww.is_empty():
		out["id"] = String(ww["id"])
		var st := wall_state(g, String(ww["id"]))
		out["pap"] = st == "pap"
		out["kind"] = "wall_buy" if st == "buy" else ("wall_full" if int(out["price"]) < 0 else "wall_ammo")
		return out
	if g.world != null and g.world.near_door(g.player.pos) >= 0:
		out["kind"] = "door"
	return out

## v0.28.0 : what a wall weapon panel offers to the player: "buy" (not carried), "ammo" (carried), "pap" (carried and Pack-a-Punched).
static func wall_state(g: Node, id: String) -> String:
	if g.arms == null:
		return "buy"
	for w: WeaponState in (g.arms as WeaponArms).inventory:
		if w.id == id:
			return "pap" if w.pap > 0 else "ammo"
	return "buy"

## Les invites de Rides et de Machines s'écrivent « E Descendre · V vue · O portes · H gong » : les lettres de touche suivent les liaisons du joueur
## (le JS les compose avec `binds.tag`, « [E] »).
static func _keys(s: String, binds: Keybinds) -> String:
	if binds == null:
		return s
	if s.begins_with("E "):
		s = "%s %s" % [binds.tag("interact"), s.substr(2)]
	s = s.replace("V vue", "%s vue" % binds.tag("vehicleView"))
	s = s.replace("O portes", "%s portes" % binds.tag("tramDoors"))
	s = s.replace("O : portes", "%s portes" % binds.tag("tramDoors"))
	s = s.replace("H gong", "%s gong" % binds.tag("tramGong"))
	s = s.replace("B aiguillage", "%s aiguillage" % binds.tag("tramSwitch"))
	s = s.replace("Espace frein d'urgence", "%s frein d'urgence" % binds.tag("jump"))
	s = s.replace("Z/Q/S/D : marcher", "%s : marcher" % binds.move_label())
	return s
