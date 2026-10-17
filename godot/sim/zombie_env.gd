class_name ZombieEnv
extends RefCounted
## Ce que voit un zombie quand il réfléchit (équivalent des arguments player / others / world de Zombie.update du JS) : joueurs, autres zombies,
## collision, grille de navigation de la carte, étages. Rempli par Game à chaque pas ; nav et levels sont null dans l'arène.

var players: Array[PlayerSim] = []
var zombies: Array[ZombieSim] = []
var collision: Collision
var nav: NavGrid            ## champ de flux de la carte (null : ligne droite, comme l'arène du JS)
var levels: Levels          ## étages (null si aucun lien d'escalier)
var rng: RandomNumberGenerator
var time := 0.0
