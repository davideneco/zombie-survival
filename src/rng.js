import { CONFIG } from './config.js';

// =====================================================================
//  Deterministic random numbers.
//  `seeded` is the Mulberry32 generator the island has always used (moved out of realworld.js, output unchanged).
//  `hash32` / `tileSeed` / `tileRng` / `districtRng` are for chunked world generation (src/tiles.js): the seed of a tile or a district depends
//  only on its own coordinates and on a stream id, never on the order in which tiles are built, so every peer (and every rebuild after an
//  unload) produces the same geometry. They use integer maths only (Math.imul, shifts): no Math.sin, so the result is the same on every engine.
//  Rule: a new system takes a new stream id (CONFIG.world.streams); nothing in the island's own `rnd` order may change.
// =====================================================================

// Mulberry32 : aléatoire reproductible pour que la map soit la même à chaque partie
export function seeded(seed) {
  const f = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.save = () => seed;       // état du générateur : permet de placer des objets « hors tirage » (voir zone.isolatedRnd)
  f.load = (s) => { seed = s; };
  return f;
}

// 32-bit hash of three integers (xorshift-multiply mixing, Murmur3 finaliser)
export function hash32(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

export const tileSeed = (ix, iz, stream) => hash32(ix, iz, CONFIG.world.seed ^ stream);
export const tileRng = (ix, iz, stream) => seeded(tileSeed(ix, iz, stream));
export const districtRng = (id, stream) => seeded(hash32(hashStr(id), CONFIG.world.seed ^ stream, 0x51ed));
