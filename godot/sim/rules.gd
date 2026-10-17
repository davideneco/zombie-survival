class_name Rules
extends RefCounted
## Constantes de règles de src/ qui NE sont PAS dans CONFIG (codées en dur dans main.js, player.js, zombie.js, zombieSkin.js).
## Tout l'équilibrage qui est dans CONFIG vient de Config ; ce qui reste ici devra être remonté dans src/config.js (puis
## re-exporté) lors d'un prochain passage sur le JS. Chaque ligne cite sa source.

# --- main.js : hitZombie (points) et startRound / boucle des manches
const POINTS_HIT := 10            ## balle qui touche sans tuer
const POINTS_KILL := 60           ## mort au corps
const POINTS_HEADSHOT := 100      ## mort à la tête
const ROUND_BASE := 4             ## zombies de la manche r : round((ROUND_BASE + r * ROUND_PER) * mult)
const ROUND_PER := 3
const SPAWN_FIRST_DELAY := 1.0    ## délai avant la première apparition d'une manche
const SPAWN_GAP_START := 2.0      ## intervalle entre deux apparitions : max(SPAWN_GAP_MIN, SPAWN_GAP_START - r * SPAWN_GAP_PER)
const SPAWN_GAP_PER := 0.1
const SPAWN_GAP_MIN := 0.4
const INTERMISSION_FIRST := 2.0   ## pause avant la manche 1
const INTERMISSION := 6.0         ## pause entre deux manches
const SPAWN_SPEED_JITTER := [0.85, 0.3]   ## vitesse du zombie = vitesse de manche x (0.85 + rand x 0.3)
const SPAWN_JITTER := 2.0         ## dispersion de la position d'apparition (m)
const CORPSE_TIME := 4.0          ## durée d'un cadavre avant retrait (zombie.deathT > 4)

# --- zombie.js
const ZOMBIE_ATTACK_WINDUP := 0.35
const ZOMBIE_FIRST_ATTACK_CD := 0.5
const ZOMBIE_SEPARATION := 0.8    ## distance en dessous de laquelle deux zombies se repoussent
const ZOMBIE_TURN_RATE := 8.0
const ZOMBIE_STUCK_RATIO := 0.4   ## avance de moins de 40 % du pas pendant ZOMBIE_STUCK_TIME s : coincé
const ZOMBIE_STUCK_TIME := 0.4
const ZOMBIE_SIDESTEP_TIME := 1.2
const ZOMBIE_SIDESTEP_ANGLE := 1.2   ## rad
const ZOMBIE_BODY_CENTER_Y := 0.82   ## zombieSkin.js : hitBody = boîte 1.0 x 1.65 x 0.8 centrée en y 0.82
const ZOMBIE_BODY_HALF := Vector3(0.5, 0.825, 0.4)
const ZOMBIE_HEAD_CENTER := Vector3(0, 1.83, 0.07)   ## hitHead = sphère de rayon 0.3 (hanches 0.95 + colonne 0.04 + tête 0.8 + 0.04)
const ZOMBIE_HEAD_RADIUS := 0.3

# --- player.js
const MOVE_ACCEL := 12.0          ## lissage de la vitesse : k = min(1, dt x 12)
const FOV_DEG := 80.0             ## settings.fov par défaut (main.js DEFAULT_SETTINGS)
const MOUSE_SENS := 0.0022        ## radians par pixel x settings.sens (1 par défaut)
const MOVING_SPREAD_MULT := 1.8   ## dispersion x1.8 en mouvement
const SPAWN_ON_GROUND_EPS := 0.02
const STICK_TO_SLOPE := 0.45     ## player.js : on colle à la pente en descendant si l'écart au sol est < 0,45 m
const PITCH_LIMIT := PI / 2 - 0.05

# --- port : périmètre de J1 (le jeu démarre avec startWeapons = fusil + M1911 ; J1 n'a qu'une arme, le M1911 de CONFIG.weapons)
const J1_WEAPON := "m1911"

# --- main.js pickSpawn : carte de Strasbourg (J2). L'apparition au sol (pickGround, champ de flux) et l'équilibrage entre joueurs arrivent en J3
const WORLD_SPAWN_MIN := 11.0     ## fenêtre d'apparition à 11-60 m du joueur ; repli 6-80 m ; dernier repli : 15 m à l'est
const WORLD_SPAWN_MAX := 60.0
const WORLD_SPAWN_MIN2 := 6.0
const WORLD_SPAWN_MAX2 := 80.0
const WORLD_SPAWN_FALLBACK := 15.0
const WINDOW_BUSY := 4.0          ## fenêtre occupée après une apparition (s)
