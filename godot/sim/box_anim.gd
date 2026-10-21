class_name BoxAnim
extends RefCounted
## v0.29.0 : pose of the mystery box animation, as a pure function of the simulation state (MysteryBox.roll / move, timings of the JS). The view
## (scenes/world/machines_view.gd + box_model.gd) only applies it; nothing here writes to the box or draws a random number (tests/test_j36.gd checks it).
## Phases (sim): roll (Config box.spin, 4.4 s) -> offer (10 s) -> sink (0.6 s) | roll -> teddy (2.2 s) -> move (3.4 s) -> the box is elsewhere.
## Returned pose (a Dictionary, every key always present):
##   lid       lid angle (rad, 0 closed .. ~1.9 open)          glow   light inside the box (0..1)
##   beam      light beam above it (0..1)                     beam_red  1 while the teddy shows (the beam turns red)
##   gun       weapon shown (bool)                            gun_y  its height above the box base (m)    gun_yaw  its turn (rad)
##   gun_scale its scale                                      gun_k  index in the pool shown while rolling (-1 : the result)
##   name      name of the result shown (bool)                blink  the offer blinks (last 3 s): visible this frame
##   teddy     teddy shown (bool)   teddy_y   teddy_yaw       teddy_shake (rad of tilt)
##   lift      box raised (m)       box_yaw  extra turn (rad)  shake  jitter amplitude (m)    scale  box scale (0 : gone)
##   sparks    spark emission (0..1)                          smoke  smoke emission (0..1)   poof  1 during the frame range of the vanishing puff
##   shown     the box is drawn at all

const LID_OPEN := 1.9
const RISE_TIME := 0.9
const GUN_TOP := 1.55        ## m above the box base at the end of the rise
const ARRIVE_TIME := 1.3     ## view-only drop of the box at its new place (after the sim's move)
const LEAVE_LIFT_AT := 1.1
const LEAVE_GONE_AT := 2.6

static func blank() -> Dictionary:
	return {"lid": 0.0, "glow": 0.0, "beam": 0.0, "beam_red": 0.0, "gun": false, "gun_y": 0.0, "gun_yaw": 0.0, "gun_scale": 1.0, "gun_k": -1,
		"name": false, "blink": true, "teddy": false, "teddy_y": 0.0, "teddy_yaw": 0.0, "teddy_shake": 0.0, "lift": 0.0, "box_yaw": 0.0,
		"shake": 0.0, "scale": 1.0, "sparks": 0.0, "smoke": 0.0, "poof": 0.0, "shown": true}

static func _ease_out(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	return 1.0 - pow(1.0 - x, 3.0)

## Lid opening with a small overshoot (ease-out-back), x in 0..1.
static func _lid_open(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	var c1 := 1.9
	var c3 := c1 + 1.0
	return LID_OPEN * (1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0))

## Number of weapon switches after t seconds of rolling: the interval grows from 0.055 s to 0.475 s (p^3), integrated in 1/60 s steps.
static func switches(t: float, spin: float) -> int:
	var n := 0.0
	var s := 0.0
	var h := 1.0 / 60.0
	while s < t:
		var p := minf(1.0, s / spin)
		n += minf(h, t - s) / (0.055 + 0.42 * p * p * p)
		s += h
	return int(n)

## Pose of box i. box: MysteryBox; time: game clock (for idle bobbing); arrive_age: seconds since this box became active after a move (view clock),
## or a large value; pool_size: number of weapons of the pool (rolling display).
static func pose(box: MysteryBox, i: int, time: float, arrive_age: float, pool_size: int) -> Dictionary:
	var P := blank()
	var active := i == box.active
	var leaving := not box.move.is_empty() and int(box.move["from"]) == i
	if not active and not leaving:
		P["shown"] = false
		return P
	if leaving:
		return _leave(P, float(box.move["t"]))
	if arrive_age < ARRIVE_TIME:
		var a := arrive_age / ARRIVE_TIME
		var fall := clampf(a / 0.55, 0.0, 1.0)
		P["lift"] = 4.0 * (1.0 - fall * fall)
		P["scale"] = clampf(a / 0.25, 0.05, 1.0)
		P["beam"] = 1.0 - a
		P["smoke"] = 1.0 if a > 0.5 and a < 0.8 else 0.0
		P["sparks"] = 1.0 if a > 0.5 and a < 0.62 else 0.0
		if a > 0.55:   # landing bounce
			P["lift"] = absf(sin((a - 0.55) / 0.45 * PI * 2.0)) * 0.06 * (1.0 - a)
	var roll := box.roll
	if roll.is_empty():
		P["glow"] = 0.12 + 0.05 * sin(time * 2.2)   # light leaking under the lid
		return P
	var ph := String(roll["phase"])
	var age := float(roll["age"])
	var t := float(roll["t"])
	var spin := float(Config.at("box.spin"))
	match ph:
		"roll":
			var p := minf(1.0, t / spin)
			P["lid"] = _lid_open(t / 0.55)
			P["glow"] = minf(1.0, t * 3.0)
			P["beam"] = minf(1.0, t * 2.0) * (0.75 + 0.25 * sin(age * 18.0))
			P["gun"] = true
			P["gun_y"] = 0.35 + (GUN_TOP - 0.35) * _ease_out(t / RISE_TIME) + sin(age * 5.0) * 0.03
			P["gun_yaw"] = age * (6.0 - 4.5 * p)
			P["gun_k"] = (switches(t, spin) * 7 + absi(hash(String(roll["result"])))) % maxi(1, pool_size)
			P["sparks"] = 1.0 - p * 0.6
		"teddy":
			P["lid"] = LID_OPEN
			P["glow"] = 1.0
			P["beam"] = 0.9
			P["beam_red"] = minf(1.0, t * 3.0)
			P["teddy"] = true
			P["teddy_y"] = 0.35 + 1.0 * _ease_out(t / 0.6) + absf(sin(t * 7.0)) * 0.08
			P["teddy_yaw"] = t * 3.0
			P["teddy_shake"] = sin(t * 23.0) * 0.18
			P["shake"] = 0.01 + 0.02 * minf(1.0, t)
		"offer":
			var left := float(roll["offer_t"])
			P["lid"] = LID_OPEN
			P["glow"] = 0.85 + 0.15 * sin(age * 4.0)
			P["beam"] = 0.55
			P["gun"] = true
			P["gun_y"] = GUN_TOP + sin(age * 3.0) * 0.05
			P["gun_yaw"] = age * 1.4
			P["name"] = true
			P["blink"] = left > Rules.BOX_OFFER_WARN or int(age * 8.0) % 2 == 0
			P["sparks"] = 0.15
		"sink":
			var k := clampf(t / Rules.BOX_SINK_TIME, 0.0, 1.0)
			P["lid"] = LID_OPEN * (1.0 - _ease_out(clampf((k - 0.35) / 0.65, 0.0, 1.0)))
			P["glow"] = 1.0 - k
			P["beam"] = 0.4 * (1.0 - k)
			P["gun"] = k < 0.9
			P["gun_y"] = GUN_TOP - (GUN_TOP - 0.2) * k * k
			P["gun_yaw"] = age * 1.4 + k * 4.0
			P["gun_scale"] = maxf(0.05, 1.0 - k)
	return P

## Leaving (MysteryBox.move, 3.4 s): the teddy waves above the box, the box shakes harder and harder, rises spinning in smoke and sparks, shrinks
## and vanishes in a puff.
static func _leave(P: Dictionary, mt: float) -> Dictionary:
	P["lid"] = LID_OPEN * maxf(0.0, 1.0 - mt * 1.5) + (absf(sin(mt * 19.0)) * 0.35 if mt > 0.7 else 0.0)
	P["glow"] = maxf(0.0, 1.0 - mt * 0.6)
	P["beam"] = maxf(0.0, 0.8 - mt * 0.5)
	P["beam_red"] = 1.0
	P["teddy"] = mt < 1.0
	P["teddy_y"] = 1.35 + mt * 0.6
	P["teddy_yaw"] = mt * 5.0
	P["teddy_shake"] = sin(mt * 23.0) * 0.25
	P["shake"] = 0.015 + 0.05 * clampf(mt / LEAVE_LIFT_AT, 0.0, 1.0)
	P["smoke"] = 1.0 if mt > 0.6 and mt < LEAVE_GONE_AT else 0.0
	P["sparks"] = 1.0 if mt > 0.9 and mt < LEAVE_GONE_AT else 0.0
	if mt > LEAVE_LIFT_AT:
		var u := mt - LEAVE_LIFT_AT
		P["lift"] = u * u * 1.6
		P["box_yaw"] = u * u * 3.0
		P["scale"] = clampf(1.0 - (mt - (LEAVE_GONE_AT - 0.5)) / 0.5, 0.0, 1.0)
	P["poof"] = 1.0 if mt >= LEAVE_GONE_AT - 0.1 and mt < LEAVE_GONE_AT + 0.25 else 0.0
	P["shown"] = mt < LEAVE_GONE_AT
	return P
