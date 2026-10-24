class_name UiTheme
extends RefCounted
## Habillage commun des menus et du HUD (index.html : titres Impact, boutons rouges / bleus, panneaux sombres) et petits constructeurs.

const RED := Color("b01818")
const RED_HOVER := Color("dd2222")
const BLUE := Color("2b4c7e")
const BLUE_HOVER := Color("3b6cb5")
const GREEN := Color("228833")
const GREEN_HOVER := Color("2eb845")
const GOLD := Color("ffd24a")
const TEXT := Color("e8e8e0")
const GREY := Color("888888")

static var _heading: Font
static var _body: Font

## Police des titres et du HUD (Impact, repli sur une grasse étroite).
static func heading() -> Font:
	if _heading == null:
		var f := SystemFont.new()
		f.font_names = PackedStringArray(["Impact", "Anton", "Arial Narrow", "Liberation Sans Narrow", "Liberation Sans", "DejaVu Sans"])
		f.font_weight = 700
		f.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
		_heading = f
	return _heading

static func body() -> Font:
	if _body == null:
		var f := SystemFont.new()
		f.font_names = PackedStringArray(["Arial", "Liberation Sans", "DejaVu Sans"])
		f.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
		_body = f
	return _body

static func box(bg: Color, border := Color(0, 0, 0, 0), bw := 0, radius := 4, margin := 6) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(bw)
	s.set_corner_radius_all(radius)
	s.content_margin_left = margin + 6
	s.content_margin_right = margin + 6
	s.content_margin_top = margin
	s.content_margin_bottom = margin
	return s

## Thème des menus : boutons rouges, variantes « Sub » (bleu) et « Go » (vert), curseurs, cases à saisie.
static func make_theme() -> Theme:
	var t := Theme.new()
	t.default_font = body()
	t.default_font_size = 16
	t.set_color("font_color", "Label", TEXT)
	for pair in [["Button", RED, RED_HOVER], ["SubButton", BLUE, BLUE_HOVER], ["GoButton", GREEN, GREEN_HOVER]]:
		var type := String(pair[0])
		if type != "Button":
			t.set_type_variation(type, "Button")
		t.set_stylebox("normal", type, box(pair[1], Color(0, 0, 0, 0), 0, 2, 8))
		t.set_stylebox("hover", type, box(pair[2], Color(0, 0, 0, 0), 0, 2, 8))
		t.set_stylebox("pressed", type, box((pair[2] as Color).darkened(0.2), Color(0, 0, 0, 0), 0, 2, 8))
		t.set_stylebox("focus", type, box(Color(0, 0, 0, 0), GOLD, 2, 2, 8))
		var dis := box((pair[1] as Color).darkened(0.55), Color(0, 0, 0, 0), 0, 2, 8)
		t.set_stylebox("disabled", type, dis)
		t.set_color("font_color", type, Color.WHITE)
		t.set_color("font_hover_color", type, Color.WHITE)
		t.set_color("font_pressed_color", type, Color.WHITE)
		t.set_color("font_disabled_color", type, Color(1, 1, 1, 0.4))
		t.set_font("font", type, heading())
		t.set_font_size("font_size", type, 24)
	t.set_stylebox("normal", "LineEdit", box(Color(0, 0, 0, 0.6), Color("666666"), 1, 4, 6))
	t.set_stylebox("focus", "LineEdit", box(Color(0, 0, 0, 0.6), RED, 1, 4, 6))
	t.set_font_size("font_size", "LineEdit", 18)
	var track := StyleBoxFlat.new()
	track.bg_color = Color(1, 1, 1, 0.18)
	track.content_margin_top = 3
	track.content_margin_bottom = 3
	t.set_stylebox("slider", "HSlider", track)
	var fill := StyleBoxFlat.new()
	fill.bg_color = RED
	fill.content_margin_top = 3
	fill.content_margin_bottom = 3
	t.set_stylebox("grabber_area", "HSlider", fill)
	t.set_stylebox("grabber_area_highlight", "HSlider", fill)
	return t

static func label(text: String, size := 16, color := TEXT, font: Font = null, outline := 0) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if font != null:
		l.add_theme_font_override("font", font)
	if outline > 0:
		l.add_theme_color_override("font_outline_color", Color.BLACK)
		l.add_theme_constant_override("outline_size", outline)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

## v0.34.7 : mise à l'échelle de l'interface. Menus et HUD sont conçus pour 1280 x 720 ; avant, sans réglage `window/stretch`, ils restaient en pixels réels
## (petits, et le menu centré au milieu d'un écran 3440 x 1440). Mode CANVAS_ITEMS : l'interface est agrandie du rapport min(largeur / 1280, hauteur / 720)
## (x 1,5 en 1920 x 1080, x 2 en 2560 x 1440 et 3440 x 1440) et nette (textes et formes redessinés à la taille réelle) ; ASPECT_EXPAND : sur un écran plus
## large (21:9) ou plus haut (16:10), la surface de l'interface s'agrandit au lieu de bandes noires (les éléments ancrés aux bords y restent). La 3D est
## toujours rendue à la taille de la fenêtre (sa résolution suit les réglages de qualité et de mise à l'échelle 3D, pas ceci).
const UI_BASE := Vector2i(1280, 720)

static func apply_ui_scale(w: Window) -> void:
	w.content_scale_size = UI_BASE
	w.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	w.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND

## Taille de la surface de l'interface (unités de l'interface) pour une fenêtre de `win` pixels (règle d'ASPECT_EXPAND ; tests).
static func ui_size(win: Vector2i) -> Vector2:
	var k := minf(float(win.x) / UI_BASE.x, float(win.y) / UI_BASE.y)
	return Vector2(win) / k

## Place un contrôle par rapport à un point d'ancrage (ax, ay en fraction de l'écran) : décalage (ox, oy) et taille (w, h).
static func place(c: Control, ax: float, ay: float, ox: float, oy: float, w: float, h: float) -> void:
	c.anchor_left = ax
	c.anchor_right = ax
	c.anchor_top = ay
	c.anchor_bottom = ay
	c.offset_left = ox
	c.offset_right = ox + w
	c.offset_top = oy
	c.offset_bottom = oy + h
	c.grow_horizontal = Control.GROW_DIRECTION_END
	c.grow_vertical = Control.GROW_DIRECTION_END

static func fill_rect(c: Control) -> void:
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	c.offset_left = 0
	c.offset_top = 0
	c.offset_right = 0
	c.offset_bottom = 0

## Texte avec contour (ombre portée du HUD) dessiné dans un _draw.
static func draw_outlined(ci: CanvasItem, font: Font, pos: Vector2, text: String, size: int, color: Color, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	ci.draw_string_outline(font, pos, text, align, width, size, 4, Color(0, 0, 0, 0.85))
	ci.draw_string(font, pos, text, align, width, size, color)

const VIGNETTE_SHADER := """
shader_type canvas_item;
uniform vec4 tint : source_color = vec4(0.63, 0.0, 0.0, 0.85);
uniform float inner = 0.4;
uniform float amount = 1.0;
void fragment() {
	vec2 d = (UV - 0.5) * vec2(1.0, 1.0);
	float r = length(d) * 1.4142;
	float a = smoothstep(inner, 1.0, r) * tint.a * amount;
	COLOR = vec4(tint.rgb, a);
}
"""

const CINEMA_SHADER := """
shader_type canvas_item;
uniform float grain = 0.085;
uint pcg(uint v) {
	uint s = v * 747796405u + 2891336453u;
	uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
	return (w >> 22u) ^ w;
}
// bruit entier PCG sur des coordonnées entières (sans sin ni grandes valeurs flottantes : pas de motif de trame selon le GPU) -> [0, 1)
float hash(vec2 p, float step_t) {
	uvec2 q = uvec2(ivec2(p));
	uint h = pcg(q.x + pcg(q.y + pcg(uint(step_t))));
	return float(h >> 8u) * (1.0 / 16777216.0);
}
void fragment() {
	vec2 d = UV - 0.5;
	float r = length(d) * 1.4142;
	float vig = smoothstep(0.52, 0.80, r) * 0.30 + smoothstep(0.80, 1.0, r) * 0.36;
	float g = hash(floor(FRAGCOORD.xy), floor(TIME * 8.0)) - 0.5;
	vec3 col = g > 0.0 ? vec3(1.0) : vec3(0.0);
	float ga = abs(g) * grain;
	float a = vig + ga * (1.0 - vig);
	COLOR = vec4(mix(col, vec3(0.0), vig / max(a, 0.0001)), a);
}
"""
