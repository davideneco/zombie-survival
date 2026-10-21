extends RefCounted
## v0.29.0 : mystery box animation (sim/box_anim.gd, applied by scenes/world/machines_view.gd). Port only (no JS golden):
##   - the pose follows the simulation: lid opens with the roll, weapons cycle more and more slowly, the result is offered with its name, blinks in
##     the last 3 s, sinks and the lid closes; the teddy rises, the box leaves (shake, lift, puff) and is drawn at its new place only;
##   - computing the pose never changes the simulation: same box state, same random draws, same game whether the pose is computed or not.

const DT := 1.0 / 60.0
const IDLE := {"mx": 0.0, "mz": 0.0}

func run(t: Node) -> void:
	if not FileAccess.file_exists("res://data/world/objects.json"):
		t.check(true, "j36 : monde cuit absent, suite sautée")
		return
	_roll_offer_sink(t)
	_teddy_move(t)
	_no_side_effect(t)

func _new(seed_value: int) -> MysteryBox:
	Game.mode = GameMode.CLASSIC
	Game.new_game(seed_value, "strasbourg", Config.at("startWeapons", []))
	Game.director.intermission = 1.0e9
	Game.points = 100000
	var box: MysteryBox = Game.machines.box
	var m: Dictionary = box.active_box()
	var yaw := float(m["yaw"])
	Game.player.pos = Vector3(float(m["pos"]["x"]) + sin(yaw) * 1.6, 0, float(m["pos"]["z"]) + cos(yaw) * 1.6)
	Game.player.vel = Vector3.ZERO
	return box

func _pool() -> int:
	return (Config.at("box.pool") as Dictionary).size()

func _pose(box: MysteryBox, i := -1) -> Dictionary:
	return BoxAnim.pose(box, box.active if i < 0 else i, Game.time, 1.0e9, _pool())

func _roll_offer_sink(t: Node) -> void:
	var box := _new(21)
	var P := _pose(box)
	t.check(P["shown"] and float(P["lid"]) == 0.0 and not P["gun"] and not P["teddy"], "repos : boîte fermée, rien au-dessus")
	box.limit = 1000   # no teddy
	t.check(Game.machines.interact(), "achat d'un tirage")
	t.check(not box.roll.is_empty() and box.roll["phase"] == "roll", "tirage en cours")
	var spin := float(Config.at("box.spin"))
	var lids: Array = []
	var ks: Array = []
	var shown_ids := {}
	var steps := int(spin / DT) + 10
	for s in steps:
		var p := _pose(box)
		if box.roll.is_empty() or box.roll["phase"] != "roll":
			break
		lids.append(float(p["lid"]))
		ks.append(int(p["gun_k"]))
		shown_ids[int(p["gun_k"])] = true
		if s % 30 == 0:
			t.check(p["gun"] and int(p["gun_k"]) >= 0 and int(p["gun_k"]) < _pool(), "tirage : une arme du lot tourne (%d)" % s)
		Game.step(DT, IDLE)
	t.check(lids.size() > 60 and lids[0] < 0.2 and lids[35] > 1.5, "le couvercle s'ouvre en 0,6 s (%.2f -> %.2f)" % [lids[0], lids[min(35, lids.size() - 1)]])
	t.check(shown_ids.size() >= 10, "au moins 10 armes différentes défilent (%d)" % shown_ids.size())
	var first := 0
	var last := 0
	for j in range(1, ks.size()):
		if ks[j] != ks[j - 1]:
			if j < 60:
				first += 1
			elif j >= ks.size() - 60:
				last += 1
	t.check(first > last * 2 and last >= 1, "les armes défilent de plus en plus lentement (%d puis %d changements par seconde)" % [first, last])
	t.check(box.roll["phase"] == "offer", "après %.1f s : l'arme est proposée" % spin)
	var p2 := _pose(box)
	t.check(p2["gun"] and int(p2["gun_k"]) == -1 and p2["name"] and p2["blink"] and absf(float(p2["gun_y"]) - BoxAnim.GUN_TOP) < 0.06, "proposition : le résultat flotte avec son nom")
	var blinked := false
	while not box.roll.is_empty() and box.roll["phase"] == "offer":
		var p3 := _pose(box)
		if float(box.roll["offer_t"]) > Rules.BOX_OFFER_WARN + 0.1:
			if int(float(box.roll["age"]) * 60.0) % 60 == 0:
				t.check(p3["blink"], "pas de clignotement avant les 3 dernières secondes")
		elif not p3["blink"]:
			blinked = true
		Game.step(DT, IDLE)
	t.check(blinked, "clignote dans les 3 dernières secondes")
	t.check(not box.roll.is_empty() and box.roll["phase"] == "sink", "non prise : elle retombe")
	var y0 := float(_pose(box)["gun_y"])
	var lid_sink: Array = []
	while not box.roll.is_empty():
		lid_sink.append(float(_pose(box)["lid"]))
		Game.step(DT, IDLE)
	t.check(lid_sink.size() > 20 and lid_sink[-1] < 0.25 and lid_sink[0] > 1.5, "le couvercle se referme (%.2f -> %.2f)" % [lid_sink[0], lid_sink[-1]])
	var pe := _pose(box)
	t.check(float(pe["lid"]) == 0.0 and not pe["gun"], "fin : boîte fermée")
	t.check(y0 > 1.0, "l'arme part d'en haut en retombant")

func _teddy_move(t: Node) -> void:
	var box := _new(22)
	Game.world.open_all_doors()   # every place open: the box can move
	box.limit = box.uses + 1
	var from := box.active
	t.check(Game.machines.interact(), "tirage du nounours")
	var saw_teddy := false
	var saw_red := false
	var guard := 0
	while (box.move.is_empty() and guard < 2000):
		var p := _pose(box)
		if not box.roll.is_empty() and box.roll["phase"] == "teddy":
			saw_teddy = saw_teddy or (p["teddy"] and not p["gun"])
			saw_red = saw_red or float(p["beam_red"]) > 0.5
		Game.step(DT, IDLE)
		guard += 1
	t.check(saw_teddy and saw_red, "nounours : il monte, le faisceau rougit")
	t.check(not box.move.is_empty() and int(box.move["from"]) == from, "la boîte s'en va")
	var lifted := false
	var poof := false
	var gone_at := -1.0
	var other_shown := false
	while not box.move.is_empty():
		var mt := float(box.move["t"])
		var p := _pose(box, from)
		lifted = lifted or float(p["lift"]) > 0.5
		poof = poof or float(p["poof"]) > 0.0
		if not p["shown"] and gone_at < 0.0:
			gone_at = mt
		var nxt := int(box.move["next"])
		if _pose(box, nxt)["shown"]:
			other_shown = true
		Game.step(DT, IDLE)
	t.check(lifted and poof, "départ : la boîte s'élève et disparaît dans un nuage")
	t.check(gone_at > 2.0 and gone_at < Rules.BOX_MOVE_TIME, "disparue avant la fin du déplacement (%.2f s)" % gone_at)
	t.check(not other_shown, "pas de seconde boîte pendant le déplacement")
	t.check(box.active != from, "elle est ailleurs")
	t.check(not _pose(box, from)["shown"] and _pose(box)["shown"], "ancienne place vide, nouvelle place occupée")
	var pa := BoxAnim.pose(box, box.active, Game.time, 0.1, _pool())
	t.check(float(pa["lift"]) > 1.0, "arrivée : elle tombe du ciel")
	var pb := BoxAnim.pose(box, box.active, Game.time, BoxAnim.ARRIVE_TIME + 0.1, _pool())
	t.check(float(pb["lift"]) == 0.0 and float(pb["scale"]) == 1.0, "arrivée : posée")

## Same game with and without the pose computed every frame (the view): identical state, identical draws.
func _no_side_effect(t: Node) -> void:
	var a := _run_game(true)
	var b := _run_game(false)
	t.check(a == b, "l'animation ne change pas la partie (%s / %s)" % [a, b])

func _run_game(with_pose: bool) -> String:
	var box := _new(23)
	box.limit = 3
	var trace: Array = []
	for s in 60 * 40:
		if s % 300 == 0 and box.roll.is_empty() and box.move.is_empty():
			Game.machines.interact()
		if with_pose:
			var before := [box.roll.duplicate(true), box.move.duplicate(true), Game.rng_loot.state, box.active, box.uses, Game.points]
			for i in box.boxes.size():
				BoxAnim.pose(box, i, Game.time, float(s) * DT, _pool())
			var after := [box.roll.duplicate(true), box.move.duplicate(true), Game.rng_loot.state, box.active, box.uses, Game.points]
			if str(before) != str(after):
				return "pose changed the sim at step %d" % s
		if not box.roll.is_empty() and box.roll["phase"] == "offer" and s % 7 == 0:
			Game.machines.box.take(Game)
		Game.step(DT, IDLE)
		if s % 120 == 0:
			trace.append("%d/%d/%d/%s" % [box.active, box.uses, Game.points, String(box.roll.get("phase", "-"))])
	return "%s|%d|%d" % [",".join(trace), Game.rng_loot.state, Game.rng.state]
