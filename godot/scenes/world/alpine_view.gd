extends Node3D
## v0.34.0 : rendu de la Station des Aiguilles (en construction).

signal progress(frac: float)

func build() -> void:
	progress.emit(1.0)
