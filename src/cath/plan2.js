// =====================================================================
//  Plan réel de la cathédrale Notre-Dame de Strasbourg, calé sur les volumes OSM (building:part)
//  dans le repère de la nef : s = distance le long de l'axe ouest -> est (m), t = latéral (t > 0 : côté sud).
//  Dimensions d'après les plans (plan masse, plan Chapuy) et le relevé OSM : façade de 52 m, nef de 65 m sur
//  8 travées, bas-côtés de 10 m, transept de 60 m, croisée sous la tour de 52 m, chœur surélevé sur la crypte,
//  chapelles Saint-Laurent (nord) et Sainte-Catherine (sud), Saint-Jean-Baptiste et Saint-André autour du chœur.
// =====================================================================

export const BLOCKS = [
  // massif occidental : narthex (sous la tribune de la grande rose) et bases des deux tours
  { id: 'narthex', r: [-46, -9, -37, 9], H: 18, tex: 'plain' },
  { id: 'towerN', r: [-46, -23.5, -37, -9], H: 18, tex: 'plain' },
  { id: 'towerS', r: [-46, 9, -37, 23.5], H: 18, tex: 'plain' },
  // nef, bas-côtés
  { id: 'nave', r: [-37, -9, 28, 9], H: 32, tex: 'nave' },
  { id: 'aisleN', r: [-37, -18.5, 28, -9], H: 14.5, tex: 'aisle' },
  { id: 'aisleS', r: [-37, 9, 28, 19], H: 14.5, tex: 'aisle' },
  // chapelles latérales
  { id: 'sideN', r: [9, -29.8, 28, -18.5], H: 11, tex: 'chapel' },   // Saint-Laurent
  { id: 'sideS', r: [9, 19, 28, 27.4], H: 11, tex: 'chapel' },     // Sainte-Catherine
  // croisée et transept
  { id: 'crossing', r: [28, -9, 46, 9], H: 36, tex: 'transept' },
  { id: 'transN', r: [28, -29.3, 46, -9], H: 28, tex: 'transept' },
  { id: 'transS', r: [28, 9, 46, 28.3], H: 28, tex: 'transept' },
  // chœur et abside, chapelles Saint-Jean-Baptiste (N) et Saint-André (S)
  { id: 'choir', r: [46, -8, 55.5, 8], H: 28, tex: 'transept' },
  { id: 'apse', r: [55.5, -5, 57.6, 5], H: 28, tex: 'transept' },
  { id: 'chapN', r: [46, -19.3, 57.5, -8], H: 12, tex: 'chapel' },
  { id: 'chapS', r: [46, 8, 57.5, 19.3], H: 12, tex: 'chapel' },
];

// Interfaces entre deux volumes qui se touchent : 'open' (rien sous le plus bas plafond), 'arcade' (arcs et piliers),
// 'partition' (mur percé d'ouvertures), 'wall' (mur plein). c : centre de l'ouverture le long de l'interface (s ou t).
const arch = (c, w, h) => ({ c, w, h, kind: 'arch' });
const door = (c, w, h) => ({ c, w, h, kind: 'door' });
export const INTERFACES = {
  'nave|aisleN': { type: 'arcade' }, 'nave|aisleS': { type: 'arcade' },
  'narthex|nave': { type: 'west' }, // mur ouest de la nef : tribune ouverte sur la grande rose (upper.js)
  'narthex|towerN': { type: 'partition', openings: [arch(-41.5, 3.6, 6)] },
  'narthex|towerS': { type: 'partition', openings: [arch(-41.5, 3.6, 6)] },
  'aisleN|towerN': { type: 'wall' }, 'aisleS|towerS': { type: 'wall' },
  'crossing|nave': { type: 'open' },
  'crossing|transN': { type: 'open' }, 'crossing|transS': { type: 'open' },
  'aisleN|transN': { type: 'open' }, 'aisleS|transS': { type: 'open' },
  'aisleN|sideN': { type: 'partition', openings: [arch(18.5, 5.4, 7.5)] },
  'aisleS|sideS': { type: 'partition', openings: [arch(18.5, 5.4, 7.5)] },
  'sideN|transN': { type: 'partition', openings: [arch(-24, 5.4, 7.5)] },
  'sideS|transS': { type: 'partition', openings: [arch(23.5, 5.4, 7.5)] },
  'choir|crossing': { type: 'open' },
  'apse|choir': { type: 'open' },
  'choir|chapN': { type: 'partition', openings: [arch(49, 3.2, 6.5), arch(53, 3.2, 6.5)] },
  'choir|chapS': { type: 'partition', openings: [arch(49, 3.2, 6.5), arch(53, 3.2, 6.5)] },
  'chapN|transN': { type: 'partition', openings: [door(-13.5, 2.8, 3.4)] },
  'chapS|transS': { type: 'partition', openings: [door(13.5, 2.8, 3.4)] },
};

const inRect = (r, s, t) => s > r[0] && s < r[2] && t > r[1] && t < r[3];
const blockAt = (s, t) => BLOCKS.find((b) => inRect(b.r, s, t));

// Interfaces et murs extérieurs : on parcourt le contour de chaque volume par pas de 0,25 m et on regarde ce qu'il y a de l'autre côté.
export function computeEdges() {
  const interfaces = new Map(); // "a|b|axe|pos" -> { a, b, axis, pos, from, to }
  const exterior = [];          // { block, axis, pos, from, to, nrm : sens de la normale sortante }
  const step = 0.25, eps = 0.06;
  for (const B of BLOCKS) {
    const [s0, t0, s1, t1] = B.r;
    // 4 côtés : [axe ('s' : le mur est à s = pos, longueur le long de t), pos, début, fin, normale sortante]
    const sides = [['s', s0, t0, t1, -1], ['s', s1, t0, t1, 1], ['t', t0, s0, s1, -1], ['t', t1, s0, s1, 1]];
    for (const [axis, pos, a, b, nrm] of sides) {
      let runStart = null, runKind = null;
      const flush = (end) => {
        if (runStart == null) return;
        if (runKind === 'ext') exterior.push({ block: B.id, axis, pos, from: runStart, to: end, nrm });
        else if (B.id < runKind) { // chaque interface une seule fois
          const key = `${B.id}|${runKind}`;
          const k = `${key}|${axis}|${pos}`;
          const cur = interfaces.get(k);
          if (cur && Math.abs(cur.to - runStart) < 0.3) cur.to = end;
          else interfaces.set(k + '|' + runStart, { a: B.id, b: runKind, axis, pos, from: runStart, to: end });
        }
        runStart = null; runKind = null;
      };
      for (let u = a; u < b - 1e-6; u += step) {
        const um = Math.min(u + step / 2, b - 1e-6);
        const out = axis === 's' ? blockAt(pos + nrm * eps, um) : blockAt(um, pos + nrm * eps);
        const kind = out ? out.id : 'ext';
        if (kind !== runKind) { flush(u); runStart = u; runKind = kind; }
      }
      flush(b);
    }
  }
  return { interfaces: [...interfaces.values()], exterior };
}

// Ordre de tri des identifiants de paires comme dans INTERFACES : 'nave|aisleN'… (on teste les deux ordres)
export function interfaceDef(a, b) { return INTERFACES[`${a}|${b}`] || INTERFACES[`${b}|${a}`] || { type: 'wall' }; }
export const blockOf = (id) => BLOCKS.find((b) => b.id === id);
export { blockAt };

// ------------------------------------------------------------------ Piliers de la nef (arcade)
export const NAVE = { s0: -37, s1: 28, hw: 9, bays: 8 };
export const PILLARS = [...Array(NAVE.bays + 1).keys()].map((k) => NAVE.s0 + (k * (NAVE.s1 - NAVE.s0)) / NAVE.bays);

// ------------------------------------------------------------------ Crypte romane (sous le chœur) et escaliers qui y descendent
export const CRYPT = { s0: 43, s1: 56, t: 8.5, y: -4.2, H: 3.8 };
// trous dans le sol de la croisée : deux escaliers (nord / sud) descendent vers l'est jusqu'à la crypte
export const CRYPT_STAIRS = [-1, 1].map((side) => ({ side, s0: 35.5, s1: 44.2, t0: side < 0 ? -7.9 : 5.5, t1: side < 0 ? -5.5 : 7.9 }));
// escaliers en colimaçon des deux tours de façade (centres, rayons du noyau et des marches) : la voûte des bases des tours
// (18 m) est percée à leur passage
export const TOWER_STAIRS = { NW: [-41.5, -16.5], SW: [-41.5, 16.5], RO: 3.8, RI: 1.3 };
const disc = (c, r, n = 28) => [...Array(n).keys()].map((k) => [c[0] + Math.cos((k / n) * Math.PI * 2) * r, c[1] + Math.sin((k / n) * Math.PI * 2) * r]);
export const CEIL_HOLES = { towerN: [disc(TOWER_STAIRS.NW, TOWER_STAIRS.RO + 0.35)], towerS: [disc(TOWER_STAIRS.SW, TOWER_STAIRS.RO + 0.35)] };
export const FLOOR_HOLES = { crossing: CRYPT_STAIRS.map((c) => [[c.s0, c.t0], [c.s1, c.t0], [c.s1, c.t1], [c.s0, c.t1]]) };
