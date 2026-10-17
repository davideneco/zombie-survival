class_name BossCtx
extends RefCounted
## Ce que le Bourreau, le Maître Tanneur et l'Ange demandent à la partie (l'objet `ctx` de boss.js / angel.js / tanner.js) : évènements à montrer,
## dégâts aux joueurs, renforts. FinaleSim l'implémente pour la partie ; les tests en posent une version qui enregistre les appels.

var want_leap := true   ## le Bourreau saute vers la tour à 45 % (scénarisé par la fin de partie)

## Évènement visible (boss_shock, boss_tele, boss_roar, boss_stun, boss_rise, boss_chain, boss_mark, boss_axe, boss_fire, tanner_vomit, angel_*).
func event(_name: String, _data: Dictionary) -> void:
	pass

## Dégâts à un joueur ; (kx, kz) : projection ou attirance ; src : "", "blast", "chain", "fire", "toxic", "holy", "axe".
func hurt_player(_p: PlayerSim, _dmg: float, _kx: float, _kz: float, _src: String) -> void:
	pass

## Identifiant réseau d'un joueur (marque de la Sentence) ; -1 : le joueur local.
func pid_of(_p: PlayerSim) -> int:
	return -1

func dust(_x: float, _y: float, _z: float, _n: int = 6) -> void:
	pass

func summon(_boss: BossSim) -> void:        ## renforts de la phase II
	pass

func glas_adds(_boss: BossSim) -> void:     ## renforts du Glas (transition à 70 %)
	pass

func summon_pest(_boss: BossSim) -> void:   ## le Maître Tanneur appelle des pestiférés
	pass

func on_leap(_boss: BossSim) -> void:       ## le Bourreau quitte l'étage
	pass
