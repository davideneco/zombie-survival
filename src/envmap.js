import * as THREE from 'three';

// Reflets d'ambiance partagés (v0.44.0, graphics.js) : la cible PMREM est CRÉÉE UNE FOIS puis réécrite (l'Aube, un autre ciel) : `env.texture` ne
// change donc jamais, et les matériaux qui s'y réfèrent directement (armes, carrosseries, verre, métal du décor) gardent une référence valide.
// Un matériau « réfléchissant » (reflective) reçoit sa propre intensité (envMapIntensity = k x zone x phase du ciel, mise à jour par graphics.js),
// alors que scene.environmentIntensity règle la part DIFFUSE de tous les autres : les métaux brillent sans éclaircir les murs.
export const env = { texture: null, mats: new Set(), tint: 1 };

export function reflective(mat, k = 1) {
  if (!mat || !mat.isMeshStandardMaterial) return mat;
  mat.userData.envK = k;
  mat.envMap = env.texture;
  mat.envMapIntensity = k * env.tint;
  env.mats.add(mat);
  return mat;
}

// intensité courante de tous les matériaux réfléchissants (appelée à chaque image)
export function setEnvTint(t) {
  env.tint = t;
  for (const m of env.mats) m.envMapIntensity = (m.userData.envK ?? 1) * t;
}
