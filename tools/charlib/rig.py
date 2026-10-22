# Skin weights of the playable characters (v0.31.0).
# Every vertex has a body region (the bone of the SDF primitive it comes from, charlib/sdf.py: a sleeve keeps the region of the arm under it). The
# region bone gets the vertex, then each joint next to that bone hands over a share across the joint: a smoothstep of the distance past the joint
# plane (along the mean direction of the two bones), limited to a radius around the joint (an armpit vertex does not follow the arm all the way down).
# The same rule applies to every mesh (body, head, hands, gear), so meshes that overlap at the neck or the wrists move together.
# Special regions: Skirt (long coats and robes: hips at the top, thighs below, by side), Hair (head, neck at the nape), Lid.L/R (upper eyelid: the
# lid bone near the lid margin, fading into the head), Jaw (lower lip and chin, fading into the head).
import numpy as np

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def joints(sk):
    """(parent, child, position, axis, half blend length, influence radius)"""
    J = []
    def d(n):
        v = sk.tail(n) - sk.head(n)
        return v / np.linalg.norm(v)
    def add(p, c, L, R, axis=None):
        pos = sk.head(c)
        if axis is None:
            axis = d(p) + d(c)
            axis = axis / np.linalg.norm(axis)
        J.append((p, c, pos, np.asarray(axis, float), L, R))
    add('Hips', 'Abdomen', 0.045, 0.4, (0, 0, 1))
    add('Abdomen', 'Torso', 0.055, 0.4, (0, 0, 1))
    add('Torso', 'Neck', 0.03, 0.2, (0, 0, 1))
    add('Neck', 'Head', 0.022, 0.2, (0, 0, 1))
    for s in ('L', 'R'):
        J.append(('Torso', 'UpperArm.' + s, sk.head('UpperArm.' + s) + np.array([0, 0, -0.005]), d('UpperArm.' + s) * 0.55 + np.array([1 if s == 'L' else -1, 0, 0]) * 0.45, 0.05, 0.14))
        add('UpperArm.' + s, 'LowerArm.' + s, 0.034, 0.13)
        add('LowerArm.' + s, 'Hand.' + s, 0.02, 0.08)
        for f in ('Index', 'Middle', 'Ring', 'Pinky'):
            add('Hand.' + s, f + '1.' + s, 0.01, 0.03)
            add(f + '1.' + s, f + '2.' + s, 0.006, 0.025)
            add(f + '2.' + s, f + '3.' + s, 0.005, 0.02)
        add('Hand.' + s, 'Thumb1.' + s, 0.012, 0.04)
        add('Thumb1.' + s, 'Thumb2.' + s, 0.008, 0.03)
        add('Thumb2.' + s, 'Thumb3.' + s, 0.006, 0.025)
        J.append(('Hips', 'UpperLeg.' + s, sk.head('UpperLeg.' + s), d('UpperLeg.' + s) * 0.8 + np.array([1 if s == 'L' else -1, 0, 0]) * 0.2, 0.065, 0.2))
        add('UpperLeg.' + s, 'LowerLeg.' + s, 0.042, 0.15)
        add('LowerLeg.' + s, 'Foot.' + s, 0.035, 0.14)
        add('Foot.' + s, 'Toe.' + s, 0.02, 0.08)
    return J

def weights(sk, P, regs, reg_names, extra=None):
    """P (N, 3) rest positions; regs (N,) region ids; reg_names: id -> name. Returns dict bone -> weights (N,)."""
    N = len(P)
    names = sk.names
    W = {}
    def addw(b, w):
        if b not in W:
            W[b] = np.zeros(N)
        W[b] += w
    rname = np.array([reg_names.get(int(r), 'Torso') if r >= 0 else 'Torso' for r in range(max(reg_names.keys(), default=0) + 1)] + ['Torso'])
    rv = np.where(regs >= 0, regs, len(rname) - 1)
    vb = rname[rv]
    J = joints(sk)
    special = {'Skirt', 'Hair', 'Hair_long'}
    for b in np.unique(vb):
        m = vb == b
        if b in special:
            continue
        if b not in names:
            print('  [rig] unknown region', b, '-> Torso')
            bb = 'Torso'
        else:
            bb = b
        idx = np.flatnonzero(m)
        Q = P[idx]
        own = np.ones(len(idx))
        shares = []
        for (p, c, pos, ax, L, R) in J:
            if bb != p and bb != c:
                continue
            s = (Q - pos) @ ax
            u = smoothstep(-L, L, s)                     # 1 = child side
            dist = np.linalg.norm(Q - pos, axis=1)
            lim = smoothstep(R, R * 0.6, dist)
            if bb == p:
                f = u * lim
                other = c
            else:
                f = (1 - u) * lim
                other = p
            shares.append((other, f))
        tot = np.zeros(len(idx))
        for other, f in shares:
            tot += f
        scale = np.where(tot > 1, 1 / np.maximum(tot, 1e-9), 1.0)
        for other, f in shares:
            w = np.zeros(N); w[idx] = f * scale
            addw(other, w)
        w = np.zeros(N); w[idx] = np.clip(1 - tot * scale, 0, 1)
        addw(bb, w)
    # long coats and robes
    m = vb == 'Skirt'
    if m.any():
        idx = np.flatnonzero(m)
        Q = P[idx]
        hz = sk.head('Hips')[2]
        kz = sk.head('LowerLeg.L')[2]
        front = smoothstep(0.03, 0.13, -Q[:, 1])
        # 0 at the hips, 1 lower; in front (the lap) the thighs take over sooner (seated, the panel lies on them instead of stretching)
        t = smoothstep(hz - 0.02, hz - 0.25 + 0.15 * front, Q[:, 2])
        t2 = smoothstep(kz + 0.08, kz - 0.1, Q[:, 2])          # below the knee: shins
        xl = sk.head('UpperLeg.L')[0]
        side = smoothstep(-xl * 0.9, xl * 0.9, Q[:, 0])        # 1 = left leg
        # the flanks (beyond the legs, |x| large) stay with the hips longer: seated, the front follows the thighs without tearing the sides
        flank = smoothstep(xl * 1.3, xl * 2.3, np.abs(Q[:, 0])) * (1 - smoothstep(0.02, 0.12, -Q[:, 1]))
        t = t * (1 - 0.55 * flank)
        for b, w in (('Hips', 1 - t), ('UpperLeg.L', t * side * (1 - t2 * 0.5)), ('UpperLeg.R', t * (1 - side) * (1 - t2 * 0.5)),
                     ('LowerLeg.L', t * side * t2 * 0.5), ('LowerLeg.R', t * (1 - side) * t2 * 0.5)):
            ww = np.zeros(N); ww[idx] = w
            addw(b, ww)
    # hair: head, the long parts below the skull follow the neck then the torso a little
    for hn in ('Hair', 'Hair_long'):
        m = vb == hn
        if m.any():
            idx = np.flatnonzero(m)
            Q = P[idx]
            nz = sk.head('Head')[2]
            t = smoothstep(nz + 0.02, nz - 0.12, Q[:, 2]) * (0.65 if hn == 'Hair_long' else 0.4)
            t2 = smoothstep(nz - 0.08, nz - 0.3, Q[:, 2]) * 0.6
            for b, w in (('Head', 1 - t), ('Neck', t * (1 - t2)), ('Torso', t * t2)):
                ww = np.zeros(N); ww[idx] = w
                addw(b, ww)
    if extra is not None:
        extra(W, P, vb)
    return W

def lid_jaw_fix(sk, W, P, vb):
    """Upper lids: only the part above the eye opening follows the lid bone; lower lid stays on the head. Jaw: fades into the head near the cheeks."""
    for s in ('L', 'R'):
        n = 'Lid.' + s
        if n not in W:
            continue
        e = sk.head('Eye.' + s)
        w = W[n]
        q = P - e
        up = smoothstep(-0.0015, 0.0035, q[:, 2])
        w2 = w * up
        W['Head'] = W.get('Head', np.zeros(len(P))) + (w - w2)
        W[n] = w2

def smooth_on_mesh(W, edges, bones, n_iter=6, mask=None):
    """Graph diffusion of the given bones' weights along the mesh edges (jaw and lid boundaries), then renormalised."""
    N = len(next(iter(W.values())))
    a, b = edges[:, 0], edges[:, 1]
    deg = np.bincount(a, minlength=N) + np.bincount(b, minlength=N)
    keys = list(W.keys())
    M = np.stack([W[k] for k in keys], axis=1)
    sel = [keys.index(k) for k in bones if k in keys]
    if not sel:
        return W
    # vertices touched: any weight in the selected bones within a few rings
    touch = (M[:, sel].sum(1) > 0)
    for _ in range(3):
        t2 = touch.copy()
        t2[a[touch[b]]] = True
        t2[b[touch[a]]] = True
        touch = t2
    for _ in range(n_iter):
        acc = np.zeros_like(M)
        np.add.at(acc, a, M[b])
        np.add.at(acc, b, M[a])
        avg = acc / np.maximum(deg, 1)[:, None]
        new = M * 0.5 + avg * 0.5
        M = np.where(touch[:, None], new, M)
    M /= np.maximum(M.sum(1, keepdims=True), 1e-9)
    return {k: M[:, i] for i, k in enumerate(keys)}

def top4(W, names):
    """Keeps the 4 largest weights per vertex, renormalised. Returns (N, 4) bone indices into names and (N, 4) weights."""
    keys = [k for k in W.keys() if k in names]
    M = np.stack([W[k] for k in keys], axis=1)
    while M.shape[1] < 4:
        M = np.concatenate([M, np.zeros((len(M), 1))], 1)
        keys.append(keys[0])
    o = np.argsort(-M, axis=1)[:, :4]
    ww = np.take_along_axis(M, o, 1)
    ww[ww < 1e-3] = 0
    ww /= np.maximum(ww.sum(1, keepdims=True), 1e-9)
    bi = np.array([names.index(k) for k in keys])[o]
    return bi, ww
