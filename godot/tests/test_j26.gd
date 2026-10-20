extends RefCounted
## v0.20.5 : compteur de FPS (FpsWindow : fenêtre glissante, min / max, chargement et pause ignorés ; réglage et touche F3).

func run(t: Node) -> void:
	var w := FpsWindow.new()
	t.check(w.frames == 0 and w.all_min == 0.0, "départ vide")
	# chargement : images lentes inactives, ignorées ; puis les premières images de jeu (3 images ET 0,5 s) le sont aussi
	for i in 5:
		w.feed(1.5, false)
	for i in 3:
		w.feed(0.1, true)
	t.check(w.frames == 0, "3 images lentes de départ ignorées")
	w.reset()
	for i in 5:
		w.feed(1.5, false)
	for i in 30:
		w.feed(1.0 / 60.0, true)   # 0,5 s de reprise : ignorées
	t.check(w.frames == 0, "la première demi-seconde de jeu est ignorée : %d" % w.frames)
	w.feed(1.0 / 60.0, true)
	for i in 120:
		w.feed(1.0 / 60.0, true)
	w.refresh()
	t.near(w.current, 60.0, "FPS courant", 1e-3)
	t.near(w.average, 60.0, "moyenne", 1e-3)
	t.near(w.win_min, 60.0, "min fenêtre", 1e-3)
	t.near(w.win_max, 60.0, "max fenêtre", 1e-3)
	t.check(w.frames >= 119 and w.frames <= 121, "~120 images mesurées : %d" % w.frames)
	# une image lente : le min la voit, la moyenne à peine
	w.feed(0.1, true)
	for i in 59:
		w.feed(1.0 / 120.0, true)
	w.refresh()
	t.near(w.win_min, 10.0, "min = l'image lente", 1e-3)
	t.near(w.win_max, 120.0, "max = les images rapides", 1e-3)
	t.check(w.average > 60.0 and w.average < 130.0, "moyenne entre les deux : %.1f" % w.average)
	t.near(w.all_min, 10.0, "min depuis le début", 1e-3)
	t.near(w.all_max, 120.0, "max depuis le début", 1e-3)
	# la fenêtre glisse : 12 s de 100 images/s font sortir l'image lente de la fenêtre, pas du min de la partie
	for i in 1200:
		w.feed(0.01, true)
	w.refresh()
	t.near(w.win_min, 100.0, "l'image lente est sortie de la fenêtre", 1e-3)
	t.near(w.average, 100.0, "moyenne glissante", 1e-3)
	t.near(w.all_min, 10.0, "min de la partie conservé", 1e-3)
	t.check(w.window_frames() <= 1001 and w.window_frames() >= 999, "fenêtre ~ 10 s : %d images" % w.window_frames())
	# pause : rien mesuré, et les images de reprise sont ignorées (pic de reprise)
	var n := w.frames
	for i in 30:
		w.feed(2.0, false)
	for i in FpsWindow.SKIP:
		w.feed(0.5, true)
	t.check(w.frames == n, "pause ignorée")
	w.feed(0.01, true)
	t.check(w.frames == n + 1, "mesure reprise")
	w.refresh()
	t.near(w.win_min, 100.0, "la pause n'a pas abaissé le min", 1e-3)
	# anneau plein : 1 500 images/s pendant 10 s dépassent la capacité sans casser les chiffres
	var w2 := FpsWindow.new()
	for i in 20000:
		w2.feed(1.0 / 1500.0, true)
	w2.refresh()
	t.check(w2.window_frames() == FpsWindow.CAP, "anneau plein")
	t.near(w2.average, 1500.0, "moyenne anneau plein", 0.5)
	t.near(w2.win_min, 1500.0, "min anneau plein", 0.5)
	w2.reset()
	t.check(w2.frames == 0 and w2.window_frames() == 0 and w2.all_min == 0.0, "remise à zéro")
	w2.feed(0.0, true)
	t.check(w2.frames == 0, "durée nulle ignorée")
	# réglage, touche
	t.check(Settings.DEFAULTS["fps"] == false, "compteur FPS : défaut NON")
	t.check(Keybinds.reserved("F3") != null and Keybinds.reserved("F9") != null and Keybinds.reserved("KeyW") == null, "F3 réservée (non modifiable), comme F9")
	var s := Settings.new("user://settings_j26.cfg")
	s.autosave = false
	s.values["fps"] = true
	s.autosave = true
	s.set_value("name", "FpsTest")
	t.check(bool(Settings.new("user://settings_j26.cfg").get_value("fps")), "compteur FPS sauvegardé")
	DirAccess.remove_absolute(ProjectSettings.globalize_path("user://settings_j26.cfg"))
