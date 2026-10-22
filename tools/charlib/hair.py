# Hair cards of the playable characters (v0.31.0): ribbons along grown locks, textured with a generated strand atlas (alpha tested in Godot,
# scenes/character_model.gd), normals bent outwards from the head so the cards light like a volume. The hair cap (an SDF shell over the skull,
# charlib/design.py) stays under the cards so that no scalp shows between them.
# A design describes its hair with locks (polylines in rest pose) built by the helpers below: roots on the scalp above a hairline, growth along a
# direction field with gravity, kept outside the head and the body.
import os, math
import numpy as np
import bpy, bmesh
from . import sdf

ATLAS_COLS = 4

def strand_texture(path, w=512, h=1024, seed=7):
    """RGBA strand clumps: 4 columns (different densities), opaque at the root (top), tips thinning out (bottom). Grey: tinted by the material colour."""
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4), np.float32)
    cw = w // ATLAS_COLS
    ys = np.arange(h)[:, None] / (h - 1)        # 0 = root (top row) .. 1 = tip
    xs = np.arange(cw)[None, :]
    for c in range(ATLAS_COLS):
        acc_a = np.zeros((h, cw)); acc_c = np.zeros((h, cw))
        n = [75, 100, 60, 90][c]
        for i in range(n):
            x0 = rng.uniform(0.08, 0.92) * cw
            amp = rng.uniform(0, 3.5); fr = rng.uniform(1, 3); ph = rng.uniform(0, 6.28)
            curve = x0 + amp * np.sin(ys * fr * 6.28 + ph) + rng.uniform(-6, 6) * ys ** 1.5
            thick = rng.uniform(0.8, 1.6)
            length = rng.uniform(0.55, 1.0)
            d = np.abs(xs - curve)
            op = rng.uniform(0.65, 1.0)
            a = np.clip(1.2 - d / thick, 0, 1) * (ys <= length) * np.clip((length - ys) / 0.12, 0, 1) * op
            shade = rng.uniform(0.4, 1.0)
            acc_c = np.where(a > acc_a, shade, acc_c)
            acc_a = np.maximum(acc_a, a)
        # soft edges of the clump and a denser core near the root
        edge = np.clip(np.minimum(xs, cw - 1 - xs) / (cw * 0.12), 0, 1)
        acc_a = acc_a * (0.55 + 0.45 * edge)
        core = np.clip(1 - np.abs(xs - cw / 2) / (cw * 0.42), 0, 1) * np.clip(1 - ys * 3.0, 0, 1) * 0.6
        acc_a = np.clip(acc_a + core, 0, 1)
        lum = (0.35 + 0.65 * acc_c) * (0.8 + 0.2 * (1 - ys))
        img[:, c * cw:(c + 1) * cw, 0] = lum
        img[:, c * cw:(c + 1) * cw, 1] = lum
        img[:, c * cw:(c + 1) * cw, 2] = lum
        img[:, c * cw:(c + 1) * cw, 3] = acc_a
    # Blender images start at the bottom row
    im = bpy.data.images.new(os.path.basename(path).rsplit('.', 1)[0], w, h, alpha=True)
    im.pixels.foreach_set(img[::-1].ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save(filepath=path)
    im.source = 'FILE'
    im.filepath = path
    im.reload()
    return im

# ------------------------------------------------------------------ locks
def scalp_roots(d, n, hairline, seed=1, jitter=0.0, region=None):
    """n roots spread over the skull (Fibonacci directions from the head centre), kept where hairline(q) > 0 (q: head-frame point / head_k)."""
    sk = d.sk
    c, hk = sk.head_c, sk.head_k
    rng = np.random.default_rng(seed)
    pts = []
    m = n * 4
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(m):
        z = 1 - 2 * (i + 0.5) / m
        r = math.sqrt(1 - z * z)
        a = ga * i
        dirv = np.array([r * math.cos(a), r * math.sin(a), z])
        dirv = dirv + rng.normal(0, jitter, 3)
        dirv /= np.linalg.norm(dirv)
        q = dirv * np.array([0.074, 0.094, 0.095]) + np.array([0, 0.016, 0.028])
        if hairline(q) <= 0:
            continue
        if region is not None and not region(q):
            continue
        pts.append(c + q * hk)
    pts = np.array(pts)
    if len(pts) > n:
        pts = pts[rng.choice(len(pts), n, replace=False)]
    return project_out(d.hair_surface(), pts)

def project_out(tree, pts, iters=12):
    """Moves points onto the surface of tree (along the gradient)."""
    p = np.array(pts, float)
    for _ in range(iters):
        dd = sdf.evaluate(tree, p)[0]
        g = sdf.gradient(tree, p)
        p = p - g * dd[:, None]
    return p

def grow(d, roots, field, length, step=0.01, gravity=0.0, stiff=0.6, lift=0.003, collide=None, seed=3, curl=0.0):
    """Grows one lock per root along field(p, i) (unit direction), with gravity, kept `lift` above the hair surface and outside `collide`."""
    rng = np.random.default_rng(seed)
    surf = d.hair_surface()
    locks = []
    L = np.atleast_1d(length)
    for k, r in enumerate(roots):
        Lk = float(L[k % len(L)]) * rng.uniform(0.85, 1.12)
        n = max(3, int(Lk / step))
        pts = [np.array(r, float)]
        dirv = field(pts[-1], 0)
        ph = rng.uniform(0, 6.28)
        for i in range(1, n + 1):
            f = field(pts[-1], i)
            g = np.array([0, 0, -1.0]) * gravity * min(1.0, i / max(n * stiff, 1))
            nd = f + g
            if curl:
                side = np.cross(nd, [0, 0, 1.0])
                if np.linalg.norm(side) > 1e-6:
                    nd = nd + side / np.linalg.norm(side) * curl * math.sin(i * 0.9 + ph)
            nd /= np.linalg.norm(nd)
            dirv = dirv * 0.35 + nd * 0.65
            dirv /= np.linalg.norm(dirv)
            p = pts[-1] + dirv * step
            # stay outside the hair surface (and the body)
            for tr, off in ((surf, lift + 0.002 * (i / n)),) + (((collide, 0.006),) if collide is not None else ()):
                dd = sdf.evaluate(tr, p[None])[0][0]
                if dd < off:
                    gr = sdf.gradient(tr, p[None])[0]
                    p = p + gr * (off - dd)
            pts.append(p)
        locks.append(np.array(pts))
    return locks

# ------------------------------------------------------------------ cards
def cards(d, locks, width, layers=1, seed=5, taper=0.45, reg='Hair'):
    """Ribbons along the locks. width: float or per lock. Returns verts, faces, uvs, normals, regions."""
    rng = np.random.default_rng(seed)
    c = d.sk.head_c
    V, F, UV, NN, RG = [], [], [], [], []
    W = np.atleast_1d(width)
    for k, lk in enumerate(locks):
        for layer in range(layers):
            w0 = float(W[k % len(W)]) * rng.uniform(0.8, 1.2) * (1 - 0.25 * layer)
            col = rng.integers(0, ATLAS_COLS)
            u0, u1 = col / ATLAS_COLS + 0.004, (col + 1) / ATLAS_COLS - 0.004
            if rng.random() < 0.5:
                u0, u1 = u1, u0
            n = len(lk)
            tw = rng.uniform(-0.4, 0.4)
            base = len(V)
            seglen = np.r_[0, np.cumsum(np.linalg.norm(np.diff(lk, axis=0), axis=1))]
            tot = max(seglen[-1], 1e-6)
            for i, p in enumerate(lk):
                t = seglen[i] / tot
                tan = lk[min(i + 1, n - 1)] - lk[max(i - 1, 0)]
                tan /= max(np.linalg.norm(tan), 1e-9)
                out = p - (c + np.array([0, 0.01, 0.0]))
                if p[2] < c[2] - 0.08:            # below the skull: away from the body axis
                    out = p - np.array([0, c[1] - 0.02, p[2] + 0.05])
                out /= max(np.linalg.norm(out), 1e-9)
                side = np.cross(tan, out)
                side /= max(np.linalg.norm(side), 1e-9)
                ang = tw * t
                side = side * math.cos(ang) + out * math.sin(ang)
                w = w0 * (1 - taper * t ** 1.3) * (0.7 + 0.3 * min(1.0, t * 6))
                off = out * (0.0015 * layer)
                V.append(p + side * w * 0.5 + off); V.append(p - side * w * 0.5 + off)
                UV.append((u0, 1 - t)); UV.append((u1, 1 - t))
                nrm = out * 0.8 + np.array([0, 0, 0.2])
                nrm /= np.linalg.norm(nrm)
                NN.append(nrm); NN.append(nrm)
                RG.append(reg if p[2] > c[2] - 0.11 else 'Hair_long'); RG.append(RG[-1])
            for i in range(n - 1):
                a = base + i * 2
                F.append((a, a + 1, a + 3, a + 2))
    return np.array(V), np.array(F), np.array(UV), np.array(NN), RG

def build(d, out, log):
    spec = d.hair
    if spec is None:
        return None
    cid = d.cid
    V, F, UV, NN, RG = [], [], [], [], []
    for grp in spec['groups']:
        v, f, uv, nn, rg = cards(d, grp['locks'], grp['width'], grp.get('layers', 1), grp.get('seed', 5), grp.get('taper', 0.45))
        if len(v) == 0:
            continue
        F.append(f + sum(len(x) for x in V))
        V.append(v); UV.append(uv); NN.append(nn); RG += rg
    V = np.concatenate(V); F = np.concatenate(F); UV = np.concatenate(UV); NN = np.concatenate(NN)
    me = bpy.data.meshes.new(cid + '_hair')
    me.vertices.add(len(V)); me.vertices.foreach_set('co', V.astype(np.float32).ravel())
    me.loops.add(len(F) * 4); me.loops.foreach_set('vertex_index', F.astype(np.int32).ravel())
    me.polygons.add(len(F)); me.polygons.foreach_set('loop_start', (np.arange(len(F)) * 4).astype(np.int32))
    me.update(calc_edges=True)
    uvl = me.uv_layers.new(name='UVMap')
    uvl.data.foreach_set('uv', UV[F.ravel()].astype(np.float32).ravel())
    me.polygons.foreach_set('use_smooth', np.ones(len(F), bool))
    me.normals_split_custom_set_from_vertices(NN.tolist())
    ob = bpy.data.objects.new('Hair', me)
    bpy.context.scene.collection.objects.link(ob)
    regs = np.array([sdf.reg_id(r) for r in RG], np.int32)
    at = me.attributes.new('reg', 'INT', 'POINT'); at.data.foreach_set('value', regs)
    import tempfile
    tex_path = os.path.join(tempfile.gettempdir(), 'zs-character-build', cid, cid + '_hair.png')
    os.makedirs(os.path.dirname(tex_path), exist_ok=True)
    img = strand_texture(tex_path, seed=spec.get('seed', 7))
    m = bpy.data.materials.new(cid + '_hair')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = img
    from .tex import hexrgb
    col = hexrgb(spec['color'])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    mix.inputs['B'].default_value = (col[0], col[1], col[2], 1)
    nt.links.new(ti.outputs['Color'], mix.inputs['A'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    nt.links.new(ti.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = spec.get('rough', 0.5)
    m.use_backface_culling = False
    try:
        m.surface_render_method = 'DITHERED'
    except Exception:
        pass
    me.materials.append(m)
    log('  hair: %d cards, %d triangles' % (sum(len(g['locks']) * g.get('layers', 1) for g in spec['groups']), len(F) * 2))
    return ob
