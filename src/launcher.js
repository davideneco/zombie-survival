import * as THREE from 'three';
import { CONFIG } from './config.js';

// =====================================================================
//  Lance-grenades M79 : un vrai projectile (CONFIG.weapons.m79.proj), simulé par pas de temps (delta time) chez tous les joueurs.
//  - le tireur lance son projectile et le diffuse aux autres : { t: 'nade', k: 'm79', o, v, pap } ; chaque machine le simule
//    pour le visuel (trajectoire, explosion), l'écart d'impact entre machines est purement visuel ;
//  - SEUL l'hôte (ou le solo) applique les dégâts : explosion de zone (game.explode -> areaDamage) et coup direct d'un projectile
//    pas encore armé, puis envoie `pts` au propriétaire (hitZombie / areaDamage avec owner) ;
//  - l'autodégât est pour le seul tireur (shell.mine), jamais pour un coéquipier (contrairement aux grenades à main) ;
//  - avant l'armement (proj.arm mètres parcourus) : 150 dégâts directs sur un zombie touché, pas d'explosion ; contre un mur : rien.
// =====================================================================

const SHELL_GEO = new THREE.CylinderGeometry(0.028, 0.028, 0.13, 8).rotateX(Math.PI / 2); // axe le long de z (avant = -z)
const SHELL_MAT = new THREE.MeshStandardMaterial({ color: 0x2f3b1f, roughness: 0.6, metalness: 0.4 }); // même shader que la grenade à main

export function installLauncher(game, { world, scene, fx }) {
  const P = () => CONFIG.weapons.m79;
  const shells = [];
  const _d = new THREE.Vector3(), _a = new THREE.Vector3();

  // Premier zombie touché par le segment [a, a + d*len] (d unitaire) : { z, t } ou null. Zombie = cylindre vertical (rayon 0,5 m,
  // du sol à 1,9 m) ; la tête de la caméra n'a pas d'importance pour un projectile à explosion.
  function zombieHit(a, d, len) {
    let best = null;
    for (const z of game.zombies) {
      if (z.dead || !z.targetable) continue;
      const dx = z.pos.x - a.x, dz = z.pos.z - a.z;
      const h2 = d.x * d.x + d.z * d.z;
      let t = h2 > 1e-9 ? (dx * d.x + dz * d.z) / h2 : 0; // t le long du segment du point le plus proche de l'axe du zombie
      t = Math.max(0, Math.min(len, t));
      const px = a.x + d.x * t - z.pos.x, pz = a.z + d.z * t - z.pos.z, py = a.y + d.y * t - z.pos.y;
      if (px * px + pz * pz > 0.25 || py < -0.1 || py > 1.9) continue;
      if (!best || t < best.t) best = { z, t };
    }
    return best;
  }

  const blastOf = (pap) => {
    const b = P().blast;
    return pap ? { radius: b.radius * 1.3, damage: b.damage * 2, self: b.self, color: b.color } : b;
  };

  Object.assign(game, {
    shells,

    // origin / vel : THREE.Vector3 ; mine : tiré par le joueur local ; owner : id du propriétaire sinon ; pap : version Pack-a-Punch
    launchShell(origin, vel, mine, owner = null, pap = false) {
      const mesh = new THREE.Mesh(SHELL_GEO, SHELL_MAT);
      mesh.position.copy(origin);
      scene.add(mesh);
      shells.push({ mesh, pos: origin.clone(), vel: vel.clone(), age: 0, dist: 0, mine, owner: mine ? null : owner, pap });
      if (mine && game.isMultiplayer) {
        game.net?.send({ t: 'nade', k: 'm79', o: { x: origin.x, y: origin.y, z: origin.z }, v: { x: vel.x, y: vel.y, z: vel.z }, pap: pap ? 1 : 0 });
      }
    },

    updateShells(dt) {
      const C = P().proj;
      for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i];
        let done = false;
        // pas de 20 ms au plus : à 60 m/s un projectile avance de 1,2 m par pas
        const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
        for (let k = 0; k < n && !done; k++) {
          s.vel.y -= C.gravity * h;
          const len = s.vel.length() * h;
          _d.copy(s.vel).normalize();
          _a.copy(s.pos);
          // premier obstacle : mur, sol ou étage (grille de collision) ou zombie
          let t = world.rayHit ? world.rayHit(_a.x, _a.y, _a.z, _d.x, _d.y, _d.z, len) : len;
          let victim = null;
          const zh = zombieHit(_a, _d, Math.min(t, len));
          if (zh && zh.t <= t) { t = zh.t; victim = zh.z; }
          s.age += h;
          if (t < len - 1e-6 || victim) { // impact
            const at = _a.clone().addScaledVector(_d, t);
            s.dist += t;
            impact(s, at, victim);
            done = true;
            break;
          }
          s.pos.addScaledVector(_d, len);
          s.dist += len;
          if (s.age >= C.fuse) { impact(s, s.pos.clone(), null); done = true; break; }
        }
        if (done) { scene.remove(s.mesh); shells.splice(i, 1); continue; }
        s.mesh.position.copy(s.pos);
        s.mesh.lookAt(s.pos.x + s.vel.x, s.pos.y + s.vel.y, s.pos.z + s.vel.z);
        fx.emit(s.pos.x, s.pos.y, s.pos.z, { count: 1, color: [0xb8b8b4, 0x8c8a85], speed: 0.15, up: 0.1, size: 0.1, life: 0.55, grav: 0, spread: 0.05 }); // sillage
      }
    },

    resetShells() {
      for (const s of shells) scene.remove(s.mesh);
      shells.length = 0;
    },
  });

  // Impact : armé -> explosion (partout visuelle, dégâts chez l'hôte) ; pas armé -> coup direct sur un zombie, sinon rien
  function impact(s, at, victim) {
    const armed = s.dist >= P().proj.arm;
    if (armed) {
      const b = blastOf(s.pap);
      game.explode(at, b.radius, b.damage, s.owner, b.color, s.mine ? b.self : false, 'blast'); // autodégât : seulement le tireur
      return;
    }
    if (victim) {
      fx.blood(at.x, at.y, at.z, false);
      if (!game.isClient) game.hitZombie(victim, false, at, P().damage * (s.pap ? 2.5 : 1), 1, s.owner); // hôte seulement ; points au propriétaire
    } else fx.dust(at.x, at.y, at.z);
  }
}
