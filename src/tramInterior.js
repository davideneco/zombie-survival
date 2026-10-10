import { CONFIG } from './config.js';
import { carDoorStarts } from './hommedefer.js';

// =====================================================================
//  Intérieur praticable de la rame (v0.40.0) : géométrie et collision LOCALES, sans Three.js ni état de jeu.
//
//  Repère de la rame (« déroulé » : les modules suivent la voie, mais on compte en ligne droite) :
//    u : abscisse le long de la rame depuis son centre, positive vers l'avant (sens des `s` croissants de la voie)
//    w : écart latéral, positif à droite de l'avant
//    y : hauteur des pieds (m, repère du monde ; plancher : CONFIG.tram.car.floor)
//  Le message réseau p_state porte (vh : identifiant de la rame, lx = w, ly = y, lz = -u (axe z du groupe d'un module : vers l'arrière), lyw : cap relatif).
//  Un point (u, w) correspond au point de la voie à l'abscisse s + u, décalé de w vers la droite : c'est continu d'un module à l'autre.
//
//  Obstacles : boîtes alignées sur les axes (u0, u1, w0, w1) : sièges, pupitres de cabine, bouts de la rame et parois ; les parois sont
//  interrompues devant les portes quand elles sont ouvertes (et la rame arrêtée) : on y passe pour monter ou descendre.
// =====================================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Construit l'intérieur d'une rame (t : { L, M, n, model: { seats } }). Renvoie { boxes, wallsClosed, wallsOpen, spans, uEnd, seatSpots }.
export function interiorOf(t) {
  const W = CONFIG.tram.walk, C = CONFIG.tram.car, L = t.L, M = t.M;
  const uEnd = L / 2 - W.endGap;                   // fin du plancher dans le nez (le décor d'intérieur s'arrête là)
  const boxes = [], uc = (mod) => -L / 2 + M / 2 + mod * M;
  const add = (list, u0, u1, w0, w1) => list.push({ u0, u1, w0, w1 });
  const seatSpots = [];
  t.model.seats.forEach((s, i) => {
    const u = uc(s.module) - s.hip[2], w = s.hip[0];
    seatSpots.push({ u, w, driver: !!s.driver, side: Math.sign(w) });
    if (s.driver) add(boxes, u - 0.24, u + 0.24, -0.26, 0.26);          // siège du conducteur
    else add(boxes, u - 0.28, u + 0.28, w - 0.22, w + 0.22);               // banquette (assise, coffre, dossier : 0,71 à 1,15 m de l'axe)
  });
  // pupitres de cabine (un à chaque bout) : 0,5 m le long de la rame, 1,9 m de large
  for (const dir of [-1, 1]) { const Xd = dir * (L / 2 - 1.95); add(boxes, Xd - 0.27, Xd + 0.27, -0.95, 0.95); }
  // bouts : le nez se resserre au-delà de uEnd
  add(boxes, uEnd, uEnd + 2, -3, 3); add(boxes, -uEnd - 2, -uEnd, -3, 3);
  // parois : de chaque côté, d'un bout à l'autre ; ouvertes devant les portes quand elles sont ouvertes
  const spans = carDoorStarts().map((d) => [d - L / 2, d - L / 2 + C.doorWidth]);
  const wallsClosed = [], wallsOpen = [];
  for (const side of [-1, 1]) {
    const w0 = side > 0 ? W.wall : -W.wall - W.thick, w1 = side > 0 ? W.wall + W.thick : -W.wall;
    add(wallsClosed, -uEnd, uEnd, w0, w1);
    let a = -uEnd;
    for (const [d0, d1] of spans) { if (d0 > a) add(wallsOpen, a, d0, w0, w1); a = Math.max(a, d1); }
    if (uEnd > a) add(wallsOpen, a, uEnd, w0, w1);
  }
  return { boxes, wallsClosed, wallsOpen, spans, uEnd, seatSpots };
}

// Pousse le cercle (rayon r) de centre p = { u, w } hors des boîtes de `lists` ; renvoie la plus grande poussée (m)
export function pushOut(lists, p, r) {
  let best = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const list of lists) {
      for (const b of list) {
        const cu = clamp(p.u, b.u0, b.u1), cw = clamp(p.w, b.w0, b.w1), du = p.u - cu, dw = p.w - cw, d2 = du * du + dw * dw;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; p.u += du * k; p.w += dw * k; best = Math.max(best, r - d); }
        else { // centre dans la boîte : on sort par la face la plus proche
          const eu = Math.min(p.u - b.u0, b.u1 - p.u), ew = Math.min(p.w - b.w0, b.w1 - p.w);
          if (eu < ew) { const dir = p.u - b.u0 < b.u1 - p.u ? -1 : 1; p.u = dir < 0 ? b.u0 - r : b.u1 + r; best = Math.max(best, eu + r); }
          else { const dir = p.w - b.w0 < b.w1 - p.w ? -1 : 1; p.w = dir < 0 ? b.w0 - r : b.w1 + r; best = Math.max(best, ew + r); }
        }
      }
    }
  }
  return best;
}

// Porte (indice 0..3 dans spans) dont l'ouverture contient u (à `margin` m près), ou -1
export function doorIndexAt(I, u, margin = 0) {
  for (let i = 0; i < I.spans.length; i++) if (u >= I.spans[i][0] - margin && u <= I.spans[i][1] + margin) return i;
  return -1;
}

// ====================================================================== installation dans le jeu
// game.tramWalkStep(p, dt)     : un pas du joueur local debout dans une rame (appelé par Player.update) ; renvoie rien, met à jour p.pos / p.yaw
// game.boardTramOnFoot(nv)     : monter à pied par une porte ouverte (nv : { v, door, side }) ; standInTram(v, seat) : se lever d'un siège
// game.updateTramBoarding(dt)  : monter en poussant contre une porte ouverte
// game.tramGoal(target, z)     : où un zombie doit aller pour atteindre une cible dans la rame (une porte ouverte) ; tramShield : la caisse protège-t-elle ?
export function installTramWalk(game, { world, hud, sfx }) {
  const T = CONFIG.tram, W = T.walk, D = T.drive;
  const tag = (id) => game.binds.tag(id);
  const f1 = {}, f2 = {}, pt = { u: 0, w: 0 }, loc = { u: 0, w: 0, d: 0 }, loc2 = { u: 0, w: 0 }, tmp = { x: 0, y: 0, z: 0 };
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const myId = () => game.net?.id ?? 0;

  // la rame (moto exclue) d'une cible de zombie : joueur local (assis ou debout), coéquipier assis (ride) ou debout (tr)
  const tramOf = (target) => {
    if (!target) return null;
    if (target === game.player) return game.player.vehicle?.v?.isTram ? game.player.vehicle.v : game.player.onTram?.v || null;
    if (target.ride?.v?.isTram) return target.ride.v;
    if (target.tr) { const t = game.rideById(target.tr.id); return t?.isTram ? t : null; }
    return null;
  };

  Object.assign(game, {
    tramOfTarget: tramOf,

    // ----------------------------------------------------------- se déplacer dans la rame
    tramWalkStep(p, dt) {
      const O = p.onTram, t = O.v;
      if (t.state === 'gone') { this.tramWalkOff(); return; }
      const I = t.interior;
      t.frame(O.u, f1);
      p.yaw += angDiff(f1.yaw, O.fy); O.fy = f1.yaw; // la vue tourne avec la rame (virages)
      // vitesse (monde) -> repère de la rame
      pt.u = O.u + (p.vel.x * f1.tx + p.vel.z * f1.tz) * dt;
      pt.w = O.w + (-p.vel.x * f1.tz + p.vel.z * f1.tx) * dt;
      const pass = t.walkOpen();
      pushOut([I.boxes, pass ? I.wallsOpen : I.wallsClosed], pt, W.radius);
      const out = Math.abs(pt.w) > W.exitW;
      if (out && pass && doorIndexAt(I, pt.u, -W.radius * 0.5) >= 0) { // dans l'ouverture : on descend
        O.u = pt.u; O.w = pt.w; this.tramStepOut(p, t);
        return;
      }
      if (Math.abs(pt.w) > W.exitW + 0.12) { // hors de la caisse sans porte (portes refermées sur le joueur) : éjecté
        O.u = pt.u; O.w = pt.w; this.tramStepOut(p, t, true);
        return;
      }
      if (!pass && t.doors.f >= W.doorOpen && Math.abs(t.v) > D.boardSpeed && Math.abs(pt.w) > W.wall - 0.5 && doorIndexAt(I, pt.u, 0.1) >= 0) {
        this.tramMoveWarn(p, t);
      }
      O.u = pt.u; O.w = pt.w;
      const floor = T.car.floor;
      O.y += (floor - O.y) * Math.min(1, dt * W.enterEase);
      if (Math.abs(floor - O.y) < 0.002) O.y = floor;
      t.walkToWorld(O.u, O.w, O.y, tmp);
      p.pos.set(tmp.x, tmp.y, tmp.z);
    },
    tramMoveWarn(p, t) {
      if (this.time < (this.tramWarnUntil || 0)) return;
      this.tramWarnUntil = this.time + 2;
      sfx.deny?.();
      hud.announce('TRAM EN MARCHE', 'Impossible de descendre : attendez l\'arrêt', 1400);
    },

    // descente à pied : le joueur est repris par le monde à côté de la rame
    tramStepOut(p, t, forced = false) {
      const O = p.onTram;
      t.walkToWorld(O.u, O.w, 0, tmp);
      p.pos.set(tmp.x, Math.max(0, O.y - 0.01), tmp.z);
      p.onTram = null; p.vy = 0; p.wasGrounded = true;
      world.collide(p.pos, CONFIG.player.radius);
      sfx.knock?.(0.35);
      if (!forced) sfx.tramChime?.(false, 0.3);
      this.sendPlayerState?.();
    },
    // sort silencieusement du repère de la rame (téléportation, réapparition, mort)
    tramWalkOff() {
      const p = this.player;
      if (!p.onTram) return;
      p.onTram = null; p.vy = 0; p.wasGrounded = true;
    },

    // ----------------------------------------------------------- monter à pied
    boardTramOnFoot(nv) {
      const p = this.player, t = nv.v, I = t.interior, span = I.spans[nv.door];
      if (!span || p.vehicle || p.onTram) return;
      t.frame((span[0] + span[1]) / 2, f1);
      p.onTram = { v: t, u: (span[0] + span[1]) / 2, w: nv.side * (W.wall - 0.05), y: Math.min(p.pos.y, T.car.floor - 0.05), fy: f1.yaw };
      p.vel.set(0, 0, 0); p.vy = 0;
      sfx.knock?.(0.35);
      this.sendPlayerState?.();
    },
    // se lever d'un siège : debout dans la rame, côté allée
    standInTram(v, seat) {
      const p = this.player, I = v.interior, sp = I.seatSpots[seat];
      v.frame(sp.u, f1);
      const w = sp.driver ? W.stand + 0.25 : sp.side * W.stand;
      p.onTram = { v, u: sp.u, w, y: T.car.floor, fy: f1.yaw };
      pt.u = sp.u; pt.w = w;
      pushOut([I.boxes, I.wallsClosed], pt, W.radius);
      p.onTram.u = pt.u; p.onTram.w = pt.w;
      p.vehicle = null; p.vel.set(0, 0, 0); p.vy = 0; p.wasGrounded = true;
      v.walkToWorld(pt.u, pt.w, T.car.floor, tmp);
      p.pos.set(tmp.x, tmp.y, tmp.z);
      p.mouseDown = false; p.aiming = false;
    },

    // pose le joueur debout dans la rame t à (u, w) (menu debug : téléportation de l'hôte près d'un coéquipier), à la case libre la plus proche
    placeInTram(t, u, w) {
      const p = this.player, I = t.interior;
      pt.u = Math.max(-I.uEnd, Math.min(I.uEnd, u)); pt.w = w;
      pushOut([I.boxes, I.wallsClosed], pt, W.radius);
      t.frame(pt.u, f1);
      p.onTram = { v: t, u: pt.u, w: pt.w, y: T.car.floor, fy: f1.yaw };
      p.vehicle = null; p.vel.set(0, 0, 0); p.vy = 0; p.wasGrounded = true; p.region = 0;
      t.walkToWorld(pt.u, pt.w, T.car.floor, tmp);
      p.pos.set(tmp.x, tmp.y, tmp.z);
      this.sendPlayerState?.();
    },

    // monter en poussant contre une porte ouverte (appelé à chaque image, joueur local à pied)
    updateTramBoarding(dt) {
      const p = this.player;
      if (p.vehicle || p.onTram || p.downed || p.dead || p.vault || !this.started) return;
      for (const t of this.trams) {
        if (!t.usable || !t.walkOpen()) continue;
        if (Math.abs(p.pos.x - t.pos.x) > 20 || Math.abs(p.pos.z - t.pos.z) > 20) continue;
        t.worldToWalk(p.pos.x, p.pos.z, loc);
        const aw = Math.abs(loc.w);
        if (aw > W.boardW || aw < W.wall - 0.1 || p.pos.y > 0.4) continue;
        const di = doorIndexAt(t.interior, loc.u, -0.2);
        if (di < 0) continue;
        t.frame(loc.u, f2);
        const vw = -p.vel.x * f2.tz + p.vel.z * f2.tx; // composante vers la droite de la rame
        if (-Math.sign(loc.w) * vw < W.boardPush) continue;
        this.boardTramOnFoot({ v: t, door: di, side: Math.sign(loc.w) });
        return;
      }
    },

    // ----------------------------------------------------------- places depuis l'intérieur, portes
    // siège libre le plus proche du joueur debout dans la rame ({ v, seat, sit: true }), ou null
    nearSeatInside() {
      const p = this.player, O = p.onTram;
      if (!O || p.downed || p.dead) return null;
      const t = O.v;
      if (!t.usable) return null;
      let best = null, bd = W.seatReach;
      t.interior.seatSpots.forEach((sp, i) => {
        if (t.seats[i] != null) return;
        const d = Math.hypot(sp.u - O.u, sp.w - O.w);
        if (d < bd) { bd = d; best = { v: t, seat: i, sit: true }; }
      });
      return best;
    },
    // porte ouverte à portée du joueur à pied, rame arrêtée : { v, seat: -1, foot: true, door, side }, ou null
    nearOpenDoor() {
      const p = this.player;
      if (p.vehicle || p.onTram || p.downed || p.dead) return null;
      let best = null, bd = W.boardReach;
      for (const t of this.trams) {
        if (!t.usable || !t.walkOpen()) continue;
        if (Math.abs(p.pos.x - t.pos.x) > 20 || Math.abs(p.pos.z - t.pos.z) > 20) continue;
        t.worldToWalk(p.pos.x, p.pos.z, loc);
        if (Math.abs(loc.w) > 4) continue;
        t.interior.spans.forEach((sp, i) => {
          const du = Math.max(0, Math.abs(loc.u - (sp[0] + sp[1]) / 2) - 0.4), dw = Math.abs(Math.abs(loc.w) - W.wall), d = Math.hypot(du, dw);
          if (d < bd) { bd = d; best = { v: t, seat: -1, foot: true, door: i, side: Math.sign(loc.w) || 1 }; }
        });
      }
      return best;
    },

    // ----------------------------------------------------------- zombies
    // Cible dans une rame aux portes ouvertes : le zombie va se tenir devant la porte ouverte la plus proche de son côté (puis frappe à 1,3 m)
    tramGoal(target, z) {
      const t = tramOf(target);
      if (!t || t.doors.f < 0.4 || t.state === 'gone') return null;
      if (Math.abs(z.pos.x - t.pos.x) > 45 || Math.abs(z.pos.z - t.pos.z) > 45) return null;
      t.worldToWalk(target.pos.x, target.pos.z, loc2);
      t.worldToWalk(z.pos.x, z.pos.z, loc);
      const side = loc.w >= 0 ? 1 : -1;
      let best = null, bd = Infinity, dz = Infinity;
      for (const sp of t.interior.spans) {
        const u = (sp[0] + sp[1]) / 2;
        t.walkToWorld(u, side * (T.car.width / 2 + W.doorSpot), 0, tmp);
        const d = Math.hypot(tmp.x - z.pos.x, tmp.z - z.pos.z), cost = d + 2 * Math.abs(u - loc2.u); // la porte la plus proche du zombie ET de sa cible
        if (cost < bd) { bd = cost; dz = d; best = { x: tmp.x, z: tmp.z }; }
      }
      return best && dz > 1.0 ? best : null;
    },
    // La caisse encaisse le coup d'un zombie (true), sauf devant une porte ouverte (le joueur à moins de 1,3 m de la porte est touché)
    tramShield(target, z) {
      const t = tramOf(target);
      if (!t) return false;
      if (t.doors.f > 0.4) {
        t.worldToWalk(z.pos.x, z.pos.z, loc);
        if (doorIndexAt(t.interior, loc.u, 0.55) >= 0 && Math.abs(loc.w) < T.car.width / 2 + W.doorSpot + 0.6) return false;
      }
      return true;
    },

    // ----------------------------------------------------------- invites
    tramWalkHint(t) { // debout dans la rame
      const B = game.binds, near = this.nearSeatInside(), kmh = Math.round(Math.abs(t.v) * 3.6);
      const state = t.walkOpen() ? 'portes ouvertes : marchez vers une porte pour descendre' : kmh > 2 ? `rame en marche (${kmh} km/h)` : `${B.label('tramDoors')} : portes`;
      if (near) return `${tag('interact')} S'asseoir${near.seat <= 1 ? ` — conducteur (cabine ${near.seat === 0 ? 'avant' : 'arrière'})` : ''} · ${state}`;
      return `${B.moveLabel()} : marcher · ${state} · ${tag('tramGong')} gong`;
    },
  });
}
