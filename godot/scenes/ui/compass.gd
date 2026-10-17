extends Control
## Boussole (HUD.drawCompass du JS) : bande de 420 x 30 px, 120 degrés visibles, N en rouge, repère doré au centre.

const W := HudCalc.COMPASS_W
const H := HudCalc.COMPASS_H

var yaw := 0.0
var marks: Array = []   ## [{ bearing, color, down }] coéquipiers (J12)

func _ready() -> void:
	custom_minimum_size = Vector2(W, H)
	size = Vector2(W, H)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func set_yaw(y: float) -> void:
	if not is_equal_approx(y, yaw):
		yaw = y
		queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(0, 0, W, H), Color(5 / 255.0, 12 / 255.0, 18 / 255.0, 0.6))
	draw_rect(Rect2(0.5, 0.5, W - 1, H - 1), Color(1, 1, 1, 0.2), false, 1.0)
	var font := UiTheme.body()
	for t: Dictionary in HudCalc.compass_ticks(yaw):
		var x: float = t["x"]
		var card: String = t["card"]
		if card != "":
			var col := Color("ff5544") if card == "N" else Color.WHITE
			draw_string(font, Vector2(x - 20, 20), card, HORIZONTAL_ALIGNMENT_CENTER, 40, 15, col)
		else:
			draw_rect(Rect2(x - 0.5, 18, 1, 8), Color(1, 1, 1, 0.45))
	var heading := HudCalc.heading_deg(yaw)
	for m: Dictionary in marks:
		var cm := HudCalc.compass_mark(float(m["bearing"]), heading)
		var x: float = cm["x"]
		var a := 0.55 if cm["edge"] else 1.0
		if m.get("down", false):
			draw_rect(Rect2(x - 6, 12, 12, 12), Color(0, 0, 0, a))
			draw_rect(Rect2(x - 5, 14, 10, 8), Color(0.88, 0.16, 0.12, a))
			draw_rect(Rect2(x - 2, 11, 4, 14), Color(0.88, 0.16, 0.12, a))
		else:
			draw_colored_polygon(PackedVector2Array([Vector2(x - 7, 11), Vector2(x + 7, 11), Vector2(x, 24)]), Color(0, 0, 0, a))
			var col := Color(m.get("color", Color("3a7bd5")))
			col.a = a
			draw_colored_polygon(PackedVector2Array([Vector2(x - 5, 12), Vector2(x + 5, 12), Vector2(x, 21)]), col)
	draw_colored_polygon(PackedVector2Array([Vector2(W / 2 - 6, 0), Vector2(W / 2 + 6, 0), Vector2(W / 2, 7)]), UiTheme.GOLD)
