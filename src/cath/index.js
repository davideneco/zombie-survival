import * as THREE from 'three';
import { Mesher, makeMaterials, roseTex } from './mesher.js';
import { buildGround, PORTAL_H } from './ground.js';
import { buildUpper } from './upper.js';
import { buildCrypt } from './crypt.js';
import { BLOCKS, blockAt } from './plan2.js';

export { PORTAL_H };

// Complète le plan de la cathédrale (repère, portail) avec l'implantation réelle de l'intérieur
export function augmentPlan(plan) {
  const { P, axis } = plan;
  const face = (dx, dz) => Math.atan2(dx, dz);
  plan.seed = P(0, 0);
  plan.altar = { p: P(57.2, 0), rot: face(-axis.ux, -axis.uz) };
  plan.pap = { p: P(51, 0), rot: face(-axis.ux, -axis.uz) };
  plan.clock = { p: P(44.3, 20), rot: face(-axis.ux, -axis.uz) };
  // plafond du volume qui contient le point (null : hors de l'intérieur)
  plan.ceilAt = (x, z) => { const b = blockAt(plan.S(x, z), plan.T(x, z)); return b ? b.H : null; };
  return plan;
}

// Construit tout l'intérieur. ctx : { scene, plan, collision, lightSources, props, levels }
export function buildCathedral(ctx) {
  const mats = makeMaterials();
  const mesher = new Mesher();
  const c = { ...ctx, mats, mesher, roseTex };
  const ground = buildGround(c);
  c.ground = ground;
  const upper = buildUpper(c);
  const out = { ground, upper, crypt: buildCrypt({ ...c, W: ctx.plan.P }) };
  mesher.build(ctx.scene);
  return out;
}
