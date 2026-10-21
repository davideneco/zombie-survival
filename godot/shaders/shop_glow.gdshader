shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled;
// v0.28.0 : glowing silhouette behind a weapon hung on its panel (scenes/world/shop_view.gd). The weapon model is drawn a second time, grown along its
// normals by `grow` metres and flattened onto the board by its parent node (scale 0.04 across the board): a lit outline the shape of the real weapon.
// Opaque and unshaded: painted luminous paint by day, glowing at night (energy follows the lamps).

uniform vec4 color : source_color = vec4(1.0, 0.7, 0.3, 1.0);
uniform float energy = 1.0;
uniform float grow = 0.014;

void vertex() {
	// MODEL_MATRIX[0] : the model's x axis (the barrel) lies along the board, never flattened: its length is the model scale
	VERTEX += NORMAL * grow / max(1e-5, length(MODEL_MATRIX[0].xyz));
}

void fragment() {
	ALBEDO = color.rgb * energy;
}
