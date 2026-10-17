class_name CharacterDefs
extends RefCounted
## Personnages jouables (choix du menu) : identifiant, nom, rôle et couleur d'accentuation (flèche de la carte, marque du radar). Copie des
## champs utiles de CHARACTERS dans src/characters.js (les modèles et les tenues arrivent avec le J9 / le réseau, J12).

const LIST := [
	{"id": "marc", "name": "MARC", "role": "Soldat", "accent": "#7cb342"},
	{"id": "lea", "name": "LÉA", "role": "Infirmière", "accent": "#4fc3f7"},
	{"id": "karim", "name": "KARIM", "role": "Pompier", "accent": "#ff8a3d"},
	{"id": "chloe", "name": "CHLOÉ", "role": "Étudiante", "accent": "#ff5c7a"},
	{"id": "lucian", "name": "LUCIAN", "role": "Le Purificateur", "accent": "#dfe6ff"},
	{"id": "picsou", "name": "PICSOU", "role": "Milliardaire", "accent": "#ffd24a"},
	{"id": "klukai", "name": "KLUKAI", "role": "Poupée tactique", "accent": "#8fd3ff"},
	{"id": "harry", "name": "HARRY", "role": "Sorcier", "accent": "#e0b040"},
]

static func of_slot(slot: int) -> Dictionary:
	return LIST[posmod(slot, LIST.size())]

static func accent(slot: int) -> Color:
	return Color(String(of_slot(slot)["accent"]))
