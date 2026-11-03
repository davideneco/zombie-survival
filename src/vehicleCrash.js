import * as THREE from 'three';
import { CONFIG } from './config.js';
import { fx } from './fx.js';

// =====================================================================
//  Collisions des voitures (v0.76.0) : carrosserie à trois cercles, réponse par impulsions (rebond, frottement, rotation) et dégâts extérieurs.
//   - Chaque cercle de la caisse est confronté au monde (world.collide) ; à chaque contact on applique une impulsion normale (rebond e) et une
//     impulsion de frottement au point de contact, avec le moment d'inertie de la caisse : un choc de face ralentit net, un choc excentré FAIT
//     TOURNER la voiture, un frôlement la fait glisser le long du mur en perdant peu de vitesse.
//   - Dégâts : PV selon l'énergie normale du choc (hôte : damageVehicle), zone touchée (avant, arrière, flancs) qui tire la voiture de travers,
//     bosses réelles dans la carrosserie (sommets déplacés, cumulées), vitres brisées, étincelles, éclats de vitre et de peinture.
//  Tous les réglages : CONFIG.vehicles.body et def.body de chaque voiture.
// =====================================================================
const colOut = { kind: null, push: 0, nx: 0, nz: 0 };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const hash3 = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _bi = new THREE.Matrix4(), _v = new THREE.Vector3();
let crackedGlass = null;
const crackedMat = () => crackedGlass ||= new THREE.MeshStandardMaterial({ color: 0x9fb2c0, roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.3, side: THREE.DoubleSide });

export const bodyMethods = {
  // Renvoie la nouvelle vitesse longitudinale ; met à jour this.pos, this.vLat et this.spin (vitesse de rotation ajoutée par les chocs)
  collideBody(sp, dt) {
    const g = this.game, D = this.def, Bd = D.body, K = CONFIG.vehicles.body;
    const fx_ = -Math.sin(this.yaw), fz_ = -Math.cos(this.yaw), rx_ = Math.cos(this.yaw), rz_ = -Math.sin(this.yaw);
    let vx = fx_ * sp + rx_ * (this.vLat || 0), vz = fz_ * sp + rz_ * (this.vLat || 0);
    const px = this.pos.x + vx * dt, pz = this.pos.z + vz * dt;
    // 1. contacts de chaque cercle
    const hits = [];
    let corrX = 0, corrZ = 0;
    for (const s of [Bd.off, 0, -Bd.off]) {
      const cx = px + fx_ * s, cz = pz + fz_ * s, q = { x: cx, y: 0.1, z: cz };
      colOut.kind = null; colOut.push = 0;
      g.world.collide(q, Bd.r, colOut);
      const dx = q.x - cx, dz = q.z - cz, d = Math.hypot(dx, dz);
      if (d < 1e-4) continue;
      hits.push({ cx, cz, nx: dx / d, nz: dz / d, depth: d, kind: colOut.kind || 'wall' });
      if (Math.abs(dx) > Math.abs(corrX)) corrX = dx;
      if (Math.abs(dz) > Math.abs(corrZ)) corrZ = dz;
    }
    this.pos.x = px + corrX; this.pos.z = pz + corrZ;
    // 2. impulsions (m = 1, moment d'inertie Bd.inertia)
    let spin = this.spin || 0, worst = 0, worstHit = null, relW = null;
    const I = Bd.inertia;
    for (const h of hits) {
      const relx = h.cx - h.nx * Bd.r - this.pos.x, relz = h.cz - h.nz * Bd.r - this.pos.z; // point de contact (sur la caisse) depuis le centre
      const vcx = vx - spin * relz, vcz = vz + spin * relx; // vitesse du point de contact : v + w x r (2D)
      const vn = vcx * h.nx + vcz * h.nz;
      if (vn >= -0.05) continue; // on s'éloigne déjà
      const rn = relx * h.nz - relz * h.nx;
      const jn = -(1 + K.restitution) * vn / (1 + rn * rn / I);
      vx += jn * h.nx; vz += jn * h.nz; spin += jn * rn / I;
      // frottement : la tangente au mur ralentit, bornée par mu x jn (frôlement = on glisse ; frontal = peu de frottement utile)
      const tx = -h.nz, tz = h.nx, vct = (vx - spin * relz) * tx + (vz + spin * relx) * tz, rt = relx * tz - relz * tx;
      const jt = clamp(-vct / (1 + rt * rt / I), -K.friction * jn, K.friction * jn);
      vx += jt * tx; vz += jt * tz; spin += jt * rt / I;
      if (-vn > worst) { worst = -vn; worstHit = h; relW = { x: relx, z: relz }; }
    }
    this.spin = clamp(spin, -K.maxSpin, K.maxSpin);
    // 3. vitesse monde -> repère de la voiture
    const nsp = vx * fx_ + vz * fz_;
    this.vLat = vx * rx_ + vz * rz_;
    if (worst > K.minImpact) this.bodyImpact(worst, worstHit, relW, fx_, fz_, rx_, rz_);
    return nsp;
  },

  // Un choc d'intensité `v` (m/s, vitesse normale d'approche) au point `rel` (centre -> contact), normale `h` (du mur vers la voiture)
  bodyImpact(v, h, rel, fx_, fz_, rx_, rz_) {
    const g = this.game, D = this.def, Bd = D.body, K = CONFIG.vehicles.body;
    if (this.impactCd > 0 && v < (this.lastImpact || 0) * 1.6) return; // même choc sur plusieurs images : une seule fois (sauf un choc bien plus fort)
    this.impactCd = K.cooldown; this.lastImpact = v;
    // dégâts en PV : fraction de la barre selon l'énergie au-delà de free
    const frac = v > K.free ? K.fracAtRef * Math.pow((v - K.free) / (K.ref - K.free), K.power) : 0;
    const lf = rel.x * fx_ + rel.z * fz_, lr = rel.x * rx_ + rel.z * rz_; // position dans la voiture : avant (+), droite (+)
    if (frac > 0) {
      g.damageVehicle(this, this.def.hp * frac, 'crash');
      const z = (this.zoneDmg ||= { front: 0, rear: 0, left: 0, right: 0 });
      const w = (a) => Math.max(0, a);
      z.front += frac * w(lf / 1.6 + 0.2); z.rear += frac * w(-lf / 1.6 + 0.2); z.right += frac * w(lr / 0.9 + 0.2); z.left += frac * w(-lr / 0.9 + 0.2);
    }
    this.crash(v, 'body'); // bruit, secousse de la caméra, blessures du conducteur (le choc ne compte pas deux fois en PV de voiture)
    // bosse : enfoncée vers l'intérieur (sens de la normale du mur), plus profonde et plus large avec la vitesse
    const depth = clamp((v - K.dentFrom) * K.dentScale, 0, K.dentMax);
    const wx = this.pos.x + rel.x, wz = this.pos.z + rel.z;
    if (depth > 0.01) {
      const radius = K.dentRadius * (0.8 + clamp(v / 25, 0, 1) * 0.9);
      const mx = h.nx * rx_ + h.nz * rz_, mz = -(h.nx * fx_ + h.nz * fz_); // normale dans le repère du modèle (x droite, z arrière)
      this.dent(lr, 0.55, -lf, mx, mz, depth, radius);
      if (g.isMultiplayer && g.net?.connected) g.net.send({ t: 'v_dent', id: this.id, x: +lr.toFixed(2), z: +(-lf).toFixed(2), dx: +mx.toFixed(2), dz: +mz.toFixed(2), a: +depth.toFixed(3), r: +radius.toFixed(2) });
    }
    // étincelles, poussière, éclats
    const px = wx, py = this.pos.y + 0.55, pz = wz, n = Math.round(clamp(v * 1.4, 6, 40));
    fx.emit(px, py, pz, { count: n, color: [0xffe0a0, 0xffa040, 0xff7a20], speed: 3 + v * 0.35, up: 1.5, size: 0.05, life: 0.5, grav: 8, spread: 0.9, glow: true });
    fx.emit(px, py, pz, { count: Math.round(n * 0.5), color: [0x9a9890, 0x6e6c66], speed: 2 + v * 0.15, up: 0.8, size: 0.2, life: 0.9, grav: -0.2, spread: 1.2 });
    if (depth > K.glassFrom) fx.emit(px, py + 0.4, pz, { count: n, color: [0xdff0ff, 0xbfd4e4], speed: 4, up: 2, size: 0.045, life: 0.8, grav: 9, spread: 1 });
    // vitres brisées à proximité d'un gros choc
    if (depth > K.glassFrom) this.breakGlass(lr, -lf, 1.7);
  },

  // ----------------------------------------------------------- bosses : déplacement réel des sommets de la carrosserie
  // (x, y, z) : centre dans le repère du modèle (x droite, z arrière) ; (dx, dz) : sens de l'enfoncement ; a : profondeur (m) ; r : rayon (m)
  dent(x, y, z, dx, dz, a, r) {
    const body = this.model?.body;
    if (!body) return;
    body.updateWorldMatrix(true, true);
    _bi.copy(body.matrixWorld).invert();
    const dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
    body.traverse((o) => {
      if (!o.isMesh || o.userData.noDent) return;
      if (!o.userData.dentReady) this.prepareDent(o);
      const pos = o.geometry.attributes.position, orig = o.userData.dentOrig;
      if (!pos) return;
      o.updateWorldMatrix(true, false);
      _m.multiplyMatrices(_bi, o.matrixWorld); _inv.copy(_m).invert();
      let touched = false;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
        const ddx = _v.x - x, ddy = (_v.y - y) * 0.8, ddz = _v.z - z, d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 >= r * r) continue;
        const w = (1 - d2 / (r * r)) ** 2, crumple = 0.7 + 0.6 * hash3(_v.x * 9, _v.y * 9, _v.z * 9);
        _v.x += ux * a * w * crumple; _v.z += uz * a * w * crumple; _v.y -= a * 0.18 * w * crumple; // enfoncement + léger affaissement
        _v.applyMatrix4(_inv);
        pos.setXYZ(i, _v.x, _v.y, _v.z);
        touched = true;
      }
      if (touched) { pos.needsUpdate = true; o.geometry.computeVertexNormals(); o.geometry.computeBoundingSphere(); o.userData.dented = true; }
    });
    this.dentCount = (this.dentCount || 0) + 1;
  },

  // Copie propre de la géométrie (jamais partagée avec une autre voiture) ; les grandes boîtes sont redécoupées pour pouvoir se froisser
  prepareDent(o) {
    o.userData.dentReady = true;
    let geo = o.geometry;
    if (geo.type === 'BoxGeometry') {
      const p = geo.parameters, big = Math.max(p.width, p.height, p.depth) > 0.35;
      if (big) {
        const seg = (s) => clamp(Math.ceil(s / 0.16), 1, 14);
        geo = new THREE.BoxGeometry(p.width, p.height, p.depth, seg(p.width), seg(p.height), seg(p.depth));
      } else geo = geo.clone();
    } else geo = geo.clone();
    o.geometry = geo;
    o.userData.dentOrig = geo.attributes.position.array.slice();
  },

  // Remet la carrosserie à neuf (réparation, réapparition) : positions d'origine, vitres intactes
  resetDents() {
    this.zoneDmg = null; this.spin = 0; this.dentCount = 0;
    const body = this.model?.body;
    if (!body) return;
    body.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.dented && o.userData.dentOrig) {
        o.geometry.attributes.position.array.set(o.userData.dentOrig);
        o.geometry.attributes.position.needsUpdate = true; o.geometry.computeVertexNormals(); o.geometry.computeBoundingSphere(); o.userData.dented = false;
      }
      if (o.userData.glass0) { o.material = o.userData.glass0; o.userData.glass0 = null; }
    });
  },

  // Vitres brisées (matériau fendillé) dans un rayon autour de (x, z) du repère du modèle
  breakGlass(x, z, r) {
    const body = this.model?.body;
    if (!body) return;
    body.updateWorldMatrix(true, true);
    _bi.copy(body.matrixWorld).invert();
    body.traverse((o) => {
      if (!o.isMesh || o.userData.glass0) return;
      const m = o.material;
      if (!m || !m.transparent || Math.abs(m.opacity - 0.48) > 0.06) return; // vitres : matériau translucide des deux voitures
      _v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(_bi);
      if (Math.hypot(_v.x - x, _v.z - z) > r) return;
      o.userData.glass0 = m; o.material = crackedMat();
    });
  },

  // Entraînement de travers : la voiture tire du côté le plus abîmé (train avant faussé), proportionnel à la vitesse
  damagePull(sp) {
    const z = this.zoneDmg;
    if (!z) return 0;
    const K = CONFIG.vehicles.body, side = clamp(z.left - z.right, -1, 1), front = clamp(z.front, 0, 1.5);
    return side * front * K.pull * clamp(Math.abs(sp) / this.def.maxSpeed, 0, 1);
  },
};
