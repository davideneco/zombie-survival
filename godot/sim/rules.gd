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
const ZOMBIE_AUTO_STUCK_RATIO := 0.25   ## avance de moins de 25 % du pas : secondes comptées dans no_progress (relocalisation)
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

# --- J3 : apparition, IA, variantes (src/zombie.js, src/main.js)
const WIN_WARN := 0.9             ## zombie.js : délai de « ça cogne contre la fenêtre » (s)
const WIN_CLIMB := 1.5            ## durée de l'enjambement de la fenêtre
const GND_DELAY := 1.1            ## délai : la terre tremble
const GND_RISE := 2.2             ## durée de la remontée
const WIN_HIT_AT := 0.85          ## targetable : fenêtre, à WIN_WARN + WIN_CLIMB x 0.85
const GND_HIT_AT := 0.7           ## sol, à GND_DELAY + GND_RISE x 0.7
const LIMP_CHANCE := 0.3          ## part de boiteux (jambe gauche à 45 %), vitesse x LIMP_SPEED
const LIMP_SPEED := 0.8
const CRAWLER_SPEED := 0.45       ## makeCrawler : vitesse x 0,45, ni coureur ni boiteux
const ARMORED_ARMOR := 0.5        ## makeKind('armored') : dégâts reçus x 0,5, vitesse x 0,8
const ARMORED_SPEED := 0.8
const ARMORED_SCALE := 1.12
const BLOAT_SPEED := 0.7          ## makeKind('bloat') : vitesse x 0,7, largeur x 1,35
const BLOAT_WIDTH := 1.35
const BLOAT_BLAST_RADIUS := 4.2   ## finale.js onFinaleKill : dégâts 38 x (1 - d / 5) à moins de 4,2 m (et 2,5 m de hauteur)
const BLOAT_BLAST_DAMAGE := 38.0
const BLOAT_BLAST_FALLOFF := 5.0
const BLOAT_BLAST_HEIGHT := 2.5
const SEE_DIST := 1.5             ## sous cette distance l'objectif est « visible » sans test de ligne de vue
const LINK_ENTER := 1.3           ## distance au pied de l'escalier à partir de laquelle le zombie s'y engage
const LINK_SPEED := 0.9           ## vitesse sur un escalier : x 0,9
const LINK_MELEE := 1.3           ## escalier : portée de frappe = attackRange + 0,2 ; arrêt à 1,3 m du joueur le long du lien
const HOP_PENALTY := 12.0         ## choix de la cible : coût d'un changement d'étage = distance d'escalier + 12 m
const VAULT_MAX_PASS := 1.3       ## _tryVault : longueur maximale de l'obstacle (m)
const VAULT_GAIN := 0.3           ## _tryVault : il faut gagner 0,3 m de marche
const VAULT_LAND := 0.5           ## _tryVault : atterrit 0,5 m après l'obstacle
const RELOCATE_INTERVAL := 1.0    ## main.js relocateZombies : une passe par seconde
const RELOCATE_FAR := 90.0        ## trop loin : farT +1 par passe ; relocalisé à 4
const RELOCATE_FAR_COUNT := 4
const RELOCATE_STUCK := 5.0       ## no_progress au-delà de 5 s et à plus de 12 m
const RELOCATE_STUCK_NEAR := 12.0
const RELOCATE_MIN := 22.0        ## nouvelle position : pickGround(22, 45)
const RELOCATE_MAX := 45.0
const GROUND_MIN := 18.0          ## pickSpawn : apparition au sol à 18-50 m
const GROUND_MAX := 50.0
const GROUND_TRIES := 80          ## realworld.js pickGround : essais
const GROUND_CLEARANCE := 1       ## 3 x 3 cases libres autour du point
const WINDOW_CHANCE := 0.65       ## pickSpawn : fenêtre d'abord avec cette probabilité
const REGION_FIELD_PERIOD := 0.3  ## updateRegionFields : champ des étages recalculé toutes les 0,3 s
const CRAWLER_HEAD := Vector3(0, 0.38, 0.82)      ## rampant : tête tenue à ~0,8 m devant les hanches (pose _poseCrawl : colonne à 1,42 rad), approximation
const CRAWLER_BODY_CENTER := Vector3(0, 0.3, 0.35)   ## hitBody du rampant : position (0, 0.3, 0.35), échelle (1, 0.42, 1.5)
const CRAWLER_BODY_HALF := Vector3(0.5, 0.3465, 0.6)

# --- port : performance de GDScript (R2 du plan). Pas dans CONFIG : ce n'est pas de l'équilibrage, c'est une limite de la machine virtuelle.
const FLOW_BUDGET_MAX := 2000     ## cases développées par pas pour le champ de flux de la carte hors fil de travail (CONFIG.zombie.flow.budget = 25 000 est réglé pour V8) : ~1,8 ms

# --- J6 : bonus, atouts, machines (src/main.js, src/player.js, src/machineFx.js ; hors CONFIG)
const POWERUP_PICKUP_RANGE := 1.7     ## main.js : ramassage d'un bonus à moins de 1,7 m (à plat)
const POWERUP_PICKUP_DY := 3.0        ## ... et |y du joueur + 0,9 - hauteur du bonus| < 3 (même étage)
const POWERUP_HOVER := 0.9            ## hauteur de base d'un bonus au-dessus du sol
const POWERUP_BOB := 0.12             ## amplitude du flottement (sin(temps x 3))
const POWERUP_BLINK_LIFE := 6.0       ## le bonus clignote pendant ses 6 dernières secondes
const NUKE_POINTS := 400              ## bombe : +400 points (non doublés)
const OPENING_BONUS_R0 := 3.0         ## ouverture de zone : rayons essayés de 3 à 9 m par pas de 1,5 m
const OPENING_BONUS_R1 := 9.0
const OPENING_BONUS_RSTEP := 1.5
const OPENING_BONUS_ANGLES := 16
const MACHINE_RANGE := 2.6            ## main.js nearMachine
const PERK_JUGGERNOG_HEALTH := 250.0  ## player.js maxHealth
const PERK_STAMIN_SPRINT := 1.3       ## player.js : sprint x1,3
const PERK_STAMIN_WALK := 1.1         ## player.js : marche x1,1
const DOWN_BLEEDOUT := 45.0           ## player.js down : saigne 45 s
const DOWN_SELF_REVIVE := 4.0         ## solo avec Réanimation rapide : se relève après 4 s
const DOWN_REVIVE_HEALTH := 50.0      ## player.js revive : min(50, santé max)
const DOWN_SPEED := 1.2               ## player.js : vitesse à terre
const BOX_TEDDY_TIME := 2.2           ## machineFx.js : durée du nounours avant le départ de la boîte
const BOX_MOVE_TIME := 3.4            ## main.js updateBoxMove : durée totale du départ et de la réapparition
const BOX_SINK_TIME := 0.6            ## machineFx.js : l'arme non prise retombe dans la boîte
const BOX_OFFER_WARN := 3.0           ## clignote quand il reste moins de 3 s
const PAP_REGRAB_GRACE := 2.0         ## machineFx.js : filet de sécurité si le propriétaire est parti
const FLOP_SHAKE := 0.45               ## main.js flop : secousse de la caméra
const LOOT_SEED_OFFSET := 7919        ## port : graine du générateur des bonus et de la boîte (Game.rng_loot) = graine de la partie + 7919
