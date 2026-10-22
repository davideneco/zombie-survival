# Builds the 8 playable characters of the Godot port (v0.31.0). Usage (Blender 5.x, no auto-run scripts):
#   blender -b --disable-autoexec --python tools/build-characters.py -- <output dir> [id ...] [--fast] [--tex=2048]
# Pipeline (modules in tools/charlib/, all original, nothing external is read):
#   1. designs.py : each character is an SDF (signed distance field) tree: anatomical body (body.py) on the shared skeleton (skel.py), face
#      (face.py), clothes and gear (design.py, cloth.py), hair cap; three grids: body (2.5 mm), head (1 mm), hands (1 mm), plus props;
#   2. mesher.py  : narrow-band evaluation, OpenVDB volume-to-mesh (dense mesh, ~1-2 M faces), Blender decimation to the budget (~25-30 k triangles);
#   3. skin weights from the SDF body regions (rig.py), extended skeleton (fingers, toes, jaw, eyes, lids);
#   4. UVs (smart projection, more texels for the face, hands and eyes), Cycles bakes (rest position, normal, normals and ambient occlusion from
#      the dense mesh), procedural PBR textures per texel (tex.py): albedo, normal, occlusion / roughness / metallic, emission;
#   5. hair cards (hair.py), animations (anims.py), export glTF (separate .gltf + .bin + .jpg/.png, see godot/assets/characters/LICENSE.txt).
import sys, os, time, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
from charlib import sdf, mesher, bl, designs, face, rig, anims, tex, hair

args = sys.argv[sys.argv.index('--') + 1:]
OUT = os.path.abspath(args[0])
FAST = '--fast' in args
TEXRES = 1024 if FAST else 2048
for a in args:
    if a.startswith('--tex='):
        TEXRES = int(a[6:])
ONLY = [a for a in args[1:] if not a.startswith('--')]
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
import tempfile
TMPDIR = os.path.join(tempfile.gettempdir(), 'zs-character-build')   # intermediate images (the exporter copies them next to the .gltf)

def log(*a):
    print('[%6.1f s]' % (time.time() - T0), *a, flush=True)

# ------------------------------------------------------------------ meshing
def mesh_part(name, tree, h, budget, lo=None, hi=None):
    pts, tris, quads = mesher.mesh(tree, h=h, lo=lo, hi=hi, log=log)
    hi_ob = bl.new_mesh(name + '_hi', pts, tris, quads)
    lo_ob = hi_ob.copy()
    lo_ob.data = hi_ob.data.copy()
    lo_ob.name = name
    bpy.context.scene.collection.objects.link(lo_ob)
    bl.decimate(lo_ob, budget)
    log('  %s: %d -> %d triangles' % (name, bl.tri_count(hi_ob), bl.tri_count(lo_ob)))
    return hi_ob, lo_ob

def set_attr(ob, name, domain, values, kind='INT'):
    me = ob.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    at = me.attributes.new(name, kind, domain)
    at.data.foreach_set('value', np.asarray(values, np.int32 if kind == 'INT' else np.float32))

def get_attr(ob, name, n):
    a = np.empty(n, np.int32)
    ob.data.attributes[name].data.foreach_get('value', a)
    return a

def face_centres(ob):
    me = ob.data
    c = np.empty(len(me.polygons) * 3, np.float32)
    me.polygons.foreach_get('center', c)
    return c.reshape(-1, 3).astype(np.float64)

def label(ob, tree, part_idx, fixed=None):
    """Region per vertex, material per face (from the SDF), part index per face."""
    V = bl.verts_of(ob)
    F = face_centres(ob)
    if fixed is None:
        _, _, reg = sdf.evaluate(tree, V)
        _, mat, _ = sdf.evaluate(tree, F)
    else:
        mat = np.full(len(F), sdf.mat_id(fixed[0]))
        reg = np.full(len(V), sdf.reg_id(fixed[1]))
    set_attr(ob, 'reg', 'POINT', reg)
    set_attr(ob, 'mat', 'FACE', mat)
    set_attr(ob, 'part', 'FACE', np.full(len(F), part_idx))

def label_high(ob, tree, part_idx, fixed_mat=None):
    """Dense mesh: per face material id and part id in a colour attribute (baked onto the low mesh: exact labels, no bleeding)."""
    me = ob.data
    F = face_centres(ob)
    mat = sdf.evaluate(tree, F)[1] if fixed_mat is None else np.full(len(F), sdf.mat_id(fixed_mat))
    mat = np.where(mat < 0, sdf.mat_id('skin'), mat)
    nl = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_total', nl)
    lf = np.repeat(np.arange(len(F)), nl)
    col = np.zeros((len(lf), 4), np.float32)
    col[:, 0] = (mat[lf] + 0.5) / 256.0
    col[:, 1] = (part_idx + 0.5) / 16.0
    col[:, 3] = 1
    ca = me.color_attributes.new('lab', 'FLOAT_COLOR', 'CORNER')
    ca.data.foreach_set('color', col.ravel())

def eye_mesh(name, c, r, side):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=r)
    # pole towards the front (-Y)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def cull_hidden(ob, keep_part, rays=24, dist=0.6):
    """Deletes the faces nobody can see: a face whose rays (cosine hemisphere around its normal) all hit the character within `dist` is enclosed
    (inner body under the clothes, neck inside the collar, wrist inside the glove, hair cap under the helmet). The eyeballs are kept (they turn)."""
    from mathutils.bvhtree import BVHTree
    import bmesh as _bm
    bm = _bm.new(); bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    pl = bm.faces.layers.int.get('part')
    rng = np.random.default_rng(0)
    dirs = rng.normal(size=(rays, 3)); dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    dead = []
    for f in bm.faces:
        if pl is not None and f[pl] == keep_part:
            continue
        n = f.normal
        c = f.calc_center_median() + n * 0.0005
        hidden = True
        for dv in dirs:
            d = Vector(dv)
            if d.dot(n) < 0:
                d = -d
            d = (d + n * 0.3).normalized()
            hit = tree.ray_cast(c, d, dist)
            if hit[0] is None:
                hidden = False
                break
        if hidden:
            dead.append(f)
    _bm.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(ob.data); bm.free()
    ob.data.update()
    return len(dead)

def join(obs, name):
    bl.select_only(*obs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob

# ------------------------------------------------------------------ bakes
def bake_image(name, res, float_buf=True):
    img = bpy.data.images.new(name, res, res, alpha=True, float_buffer=float_buf)
    img.generated_color = (0, 0, 0, 0)
    return img

def temp_material(img, emit=None):
    """Material whose emission is `emit` (callable building nodes -> output socket); the image node is the bake target."""
    m = bpy.data.materials.new('bake_tmp')
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(em.outputs[0], out.inputs[0])
    if emit is not None:
        nt.links.new(emit(nt), em.inputs['Color'])
    it = nt.nodes.new('ShaderNodeTexImage')
    it.image = img
    nt.nodes.active = it
    return m

def emit_position(nt):
    g = nt.nodes.new('ShaderNodeNewGeometry')
    add = nt.nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'
    add.inputs[1].default_value = (2.0, 2.0, 2.0)
    nt.links.new(g.outputs['Position'], add.inputs[0])
    return add.outputs[0]

def emit_normal(nt):
    g = nt.nodes.new('ShaderNodeNewGeometry')
    m = nt.nodes.new('ShaderNodeVectorMath'); m.operation = 'MULTIPLY_ADD'
    m.inputs[1].default_value = (0.5, 0.5, 0.5); m.inputs[2].default_value = (0.5, 0.5, 0.5)
    nt.links.new(g.outputs['Normal'], m.inputs[0])
    return m.outputs[0]

def emit_attr(name):
    def f(nt):
        a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = name
        return a.outputs['Color']
    return f

def do_bake(low, high, img, kind, emit=None, samples=1, extrusion=0.0, maxdist=0.0):
    m = temp_material(img, emit)
    low.data.materials.clear()
    low.data.materials.append(m)
    if high is not None:
        high.data.materials.clear()
        if emit is not None:
            high.data.materials.append(temp_material(img, emit))
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.bake.margin = 24
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = False
    if high is not None:
        bl.select_only(low)
        high.select_set(True)
        bpy.context.view_layer.objects.active = low
        sc.render.bake.use_selected_to_active = True
        sc.render.bake.cage_extrusion = extrusion
        sc.render.bake.max_ray_distance = maxdist
    else:
        bl.select_only(low)
        sc.render.bake.use_selected_to_active = False
    t = time.time()
    if kind == 'NORMAL':
        sc.render.bake.normal_space = 'TANGENT'
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=high is not None)
    else:
        bpy.ops.object.bake(type=kind, use_selected_to_active=high is not None)
    log('  bake %s %.1f s' % (kind, time.time() - t))
    low.data.materials.clear()
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)

# ------------------------------------------------------------------ texture synthesis
def synth(d, trees_by_part, part_names, pos, nrm, part, ao, nmap, pos_lo, partf_img=None):
    H, W = pos.shape[:2]
    valid = pos_lo[..., 3] > 0.5
    P_hi = pos[..., :3] - 2.0
    P_lo = pos_lo[..., :3] - 2.0
    # the ray from the low surface may reach another layer (inside of an open coat -> the legs): then the low position is labelled from the SDF
    far = (np.linalg.norm(P_hi - P_lo, axis=-1) > 0.004) | (pos[..., 3] < 0.5)
    P = np.where(far[..., None], P_lo, P_hi)
    N = nrm[..., :3] * 2 - 1
    N /= np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-6)
    vi = np.flatnonzero(valid.ravel())
    Pv, Nv, Av = P.reshape(-1, 3)[vi], N.reshape(-1, 3)[vi], ao.reshape(-1, 4)[vi, 0]
    lab = part.reshape(-1, 4)[vi]
    mats = np.floor(lab[:, 0] * 256).astype(np.int32)
    mats = np.where((mats < 0) | (lab[:, 3] < 0.5), sdf.mat_id('skin'), mats)
    fv = far.ravel()[vi]
    if fv.any():
        q = Pv[fv]
        # the part of the low face this texel belongs to (body, head, hands, prop, eyes): only its own SDF labels it
        pk = np.round(partf_img.reshape(-1, 4)[vi][fv, 0] * 16).astype(int)
        bm = np.full(len(q), -1, np.int32)
        for k, pn in enumerate(part_names):
            sel = pk == k
            if not sel.any():
                continue
            tr = trees_by_part[pn]
            bm[sel] = sdf.mat_id(tr) if isinstance(tr, str) else sdf.evaluate(tr, q[sel])[1]
        eye_m = np.abs(np.linalg.norm(q[:, None, :] - np.array(face.eye_centres(d.sk)[0])[None], axis=-1).min(1) - face.eye_centres(d.sk)[1]) < 0.002
        bm = np.where(eye_m, sdf.mat_id('eye'), bm)
        mats[fv] = np.where(bm >= 0, bm, mats[fv])
        log('  [tex] %d texels labelled at the low surface (the bake ray reached another layer)' % fv.sum())
    inv = {v: k for k, v in sdf.MATS.items()}
    n = len(vi)
    col = np.zeros((n, 3)); rough = np.full(n, 0.8); metal = np.zeros(n); height = np.zeros(n); emit = np.zeros((n, 3)); skin = np.zeros(n)
    extra = d.tex_extra()
    for mid in np.unique(mats):
        name = inv.get(int(mid), None)
        spec = d.palette.get(name) if name else None
        m = mats == mid
        if spec is None:
            log('  [tex] no palette entry for material', name)
            spec = dict(kind='plastic', color=0xff00ff)
        o = tex.shade(spec['kind'], spec, Pv[m], Nv[m], Av[m], int(mid) * 13 + 1, extra)
        col[m], rough[m], metal[m], height[m], emit[m], skin[m] = o.col, o.rough, o.metal, o.height, o.emit, o.skin
    # seams and stitches
    for f in d.seams:
        sel = np.ones(n, bool)
        if getattr(f, 'mats', None):
            ids = [sdf.MATS[x] for x in f.mats if x in sdf.MATS]
            sel = np.isin(mats, ids)
        if not sel.any():
            continue
        st, gr = f(Pv[sel])
        thread = getattr(f, 'thread', None)
        c = col[sel]
        tc = tex.hexrgb(thread) if thread is not None else c * 0.55
        c = c * (1 - st[:, None] * 0.6) + (tc if thread is not None else c * 0.55) * st[:, None] * 0.6
        c = c * (1 - 0.25 * gr[:, None])
        col[sel] = c
        height[sel] += -0.0004 * gr + 0.00015 * st
    # cavity: a bit of the occlusion goes into the albedo
    col = col * (1.0 - (0.28 - 0.16 * skin) * (1.0 - Av))[:, None]     # less on the skin (soft shadows, no dark creases)
    # images
    def img_of(v, ch):
        a = np.zeros((H * W, ch))
        a[vi] = v.reshape(n, ch)
        return a.reshape(H, W, ch)
    alb = img_of(tex.lin_to_srgb(col), 3)
    orm = img_of(np.stack([Av, rough, metal], 1), 3)
    em = img_of(tex.lin_to_srgb(np.clip(emit, 0, 1)), 3)
    hgt = img_of(height, 1)[..., 0]
    # detail normals from the height map, in UV space (tangent = +U, bitangent = +V: the pixel rows of a Blender image grow with V)
    Pg = np.where(valid[..., None], P, np.nan)
    du = np.nanmedian(np.linalg.norm(Pg[:, 2:] - Pg[:, :-2], axis=-1)) / 2
    dv = np.nanmedian(np.linalg.norm(Pg[2:] - Pg[:-2], axis=-1)) / 2
    hx = np.zeros_like(hgt); hy = np.zeros_like(hgt)
    vm = valid.astype(float)
    hx[:, 1:-1] = np.where(vm[:, 2:] * vm[:, :-2] > 0, (hgt[:, 2:] - hgt[:, :-2]) / (2 * du), 0)
    hy[1:-1] = np.where(vm[2:] * vm[:-2] > 0, (hgt[2:] - hgt[:-2]) / (2 * dv), 0)
    n2 = np.stack([-hx, -hy, np.ones_like(hx)], -1)
    n2 /= np.linalg.norm(n2, axis=-1, keepdims=True)
    n1 = nmap[..., :3] * 2 - 1
    n1 = np.where(valid[..., None], n1, np.array([0, 0, 1.0]))
    nn = np.concatenate([n1[..., :2] + n2[..., :2], (n1[..., 2] * n2[..., 2])[..., None]], -1)
    nn /= np.maximum(np.linalg.norm(nn, axis=-1, keepdims=True), 1e-6)
    nrm_img = nn * 0.5 + 0.5
    # outside the islands: dilate (mip levels do not bleed black)
    alb, orm, em, nrm_img = [dilate(x, valid) for x in (alb, orm, em, nrm_img)]
    sk_img = dilate(img_of(skin, 1), valid)
    return alb, orm, em, nrm_img, sk_img, bool((emit > 0.002).any())

def dilate(img, valid, steps=24):
    out = img.copy()
    v = valid.copy()
    for _ in range(steps):
        if v.all():
            break
        acc = np.zeros_like(out); cnt = np.zeros(v.shape)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sv = np.roll(v, (dy, dx), (0, 1))
            so = np.roll(out, (dy, dx), (0, 1))
            acc += np.where(sv[..., None], so, 0)
            cnt += sv
        new = (~v) & (cnt > 0)
        out[new] = acc[new] / cnt[new][:, None]
        v = v | new
    if not v.all():
        out[~v] = out[v].mean(0)
    return out

def save_image(name, arr, path, fmt='JPEG', quality=92, srgb=True):
    H, W, C = arr.shape
    img = bpy.data.images.new(name, W, H, alpha=(C == 4), is_data=not srgb)
    rgba = np.ones((H, W, 4), np.float32)
    rgba[..., :C] = arr
    if C == 1:
        rgba[..., 1] = rgba[..., 2] = rgba[..., 0]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = fmt
    sc = bpy.context.scene
    sc.render.image_settings.quality = quality
    img.save(filepath=path, quality=quality)
    img.source = 'FILE'
    img.filepath = path
    img.reload()
    if not srgb:
        img.colorspace_settings.name = 'Non-Color'
    return img

def fp_texture(d, out, res=256):
    """First-person glove, sleeve and cuff fabric (scenes/hands_rig.gd): each material on a flat 12 cm patch, made tileable, divided by twice its
    mean colour (the game tints it with the outfit colour): <id>_fp_glove.jpg, <id>_fp_sleeve.jpg, <id>_fp_cuff.jpg."""
    extra = d.tex_extra()
    u = (np.arange(res) + 0.5) / res * 0.12
    X, Z = np.meshgrid(u, u)
    P = np.stack([X.ravel(), np.full(X.size, -0.1), Z.ravel() + 1.0], 1)
    N = np.tile([0, -1.0, 0], (len(P), 1))
    t = np.minimum(np.arange(res), res - 1 - np.arange(res)) / (res / 2)
    w = np.clip(np.minimum.outer(t, t) * 2.2, 0, 1)[..., None]
    for key in ('glove', 'sleeve', 'cuff'):
        name = d.fp[key]
        sp = dict(d.palette.get(name, dict(kind='plastic', color=0x808080)))
        sp['dirt'] = 0.0
        ex = dict(extra)
        if sp['kind'] == 'skin':
            ex['head_frame'] = None; ex['nails'] = None
        o = tex.shade(sp['kind'], sp, P, N, np.ones(len(P)), sdf.mat_id(name) * 13 + 1, ex)
        c = (o.col / np.maximum(o.col.mean(0), 1e-4)).reshape(res, res, 3)
        c = c * w + np.roll(c, (res // 2, res // 2), (0, 1)) * (1 - w)     # seamless when repeated
        save_image('%s_fp_%s' % (d.cid, key), tex.lin_to_srgb(np.clip(c * 0.5, 0, 1)), os.path.join(out, '%s_fp_%s.jpg' % (d.cid, key)), quality=90)

def gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g is None:
        g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g

def pbr_material(name, alb, nrm, orm, emis=None, rough_k=None, alpha=None, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = alb
    nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha is not None:
        nt.links.new(ta.outputs['Alpha'], bsdf.inputs['Alpha'])
        m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            pass
        m.alpha_threshold = alpha if hasattr(m, 'alpha_threshold') else None
    if nrm is not None:
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if orm is not None:
        to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm
        sp = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(to.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sp.outputs['Blue'], bsdf.inputs['Metallic'])
        go = nt.nodes.new('ShaderNodeGroup'); go.node_tree = gltf_output_group()
        nt.links.new(sp.outputs['Red'], go.inputs['Occlusion'])
    else:
        bsdf.inputs['Roughness'].default_value = rough_k if rough_k is not None else 0.6
    if emis is not None:
        te = nt.nodes.new('ShaderNodeTexImage'); te.image = emis
        nt.links.new(te.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 1.0
    m.use_backface_culling = not double
    return m

# ------------------------------------------------------------------ build one character
def build(cid):
    log('== ' + cid)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    d = designs.CHARS[cid]()
    sk = d.sk
    T = d.trees()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    k = 1.6 if FAST else 1.0
    bk = 1.22   # ~20 % of the faces are hidden (inside the clothes) and removed after the decimation
    specs = [('body', T['body'], 0.0025 * k, int(d.budget['body'] * bk), None, None)]
    hlo = T['head'].lo.copy() + sdf.MARGIN * 0.5
    hlo[2] = d.collar_z - 0.025
    specs.append(('head', T['head'], 0.001 * k, int(d.budget['head'] * bk), hlo, T['head'].hi - sdf.MARGIN * 0.5))
    specs.append(('hands', T['hands'], 0.001 * k, int(d.budget['hands'] * 1.1), None, None))
    for pn, tr in (d.props.items() if not os.environ.get('ZS_NOPROPS') else []):
        specs.append(('Prop_' + pn, tr, 0.0012 * k, d.budget['props'], None, None))
    part_names = [s[0] for s in specs] + ['eyes']
    trees_by_part = {s[0]: s[1] for s in specs}
    trees_by_part['eyes'] = 'eye'
    his, los = [], []
    for i, (nm, tr, h, bud, lo, hi) in enumerate(specs):
        hob, lob = mesh_part(nm, tr, h, bud, lo, hi)
        label(lob, tr, i)
        label_high(hob, tr, i)
        his.append(hob); los.append(lob)
    # eyeballs (same mesh for the bake source and the result)
    eyes, re = face.eye_centres(sk)
    for e, s in zip(eyes, ('L', 'R')):
        ob = eye_mesh('eye_' + s, e, re, s)
        label(ob, None, len(specs), fixed=('eye', 'Eye.' + s))
        hob = ob.copy(); hob.data = ob.data.copy(); bpy.context.scene.collection.objects.link(hob)
        label_high(hob, None, len(specs), fixed_mat='eye')
        his.append(hob); los.append(ob)
    low = join(los, cid + '_body')
    high = join(his, cid + '_high')
    nd = cull_hidden(low, len(specs))
    log('hidden faces removed: %d' % nd)
    nv, nf = len(low.data.vertices), len(low.data.polygons)
    log('low: %d vertices, %d triangles' % (nv, bl.tri_count(low)))
    # UVs: more texels on the face, the hands and the eyes
    partf = get_attr(low, 'part', nf)
    regf = None
    w = np.ones(nf)
    w[partf == part_names.index('head')] = 1.9
    w[partf == part_names.index('hands')] = 1.5
    w[partf == part_names.index('eyes')] = 5.0
    bl.shade_smooth(low)
    bl.smart_uv(low, margin=0.003, weights=w)
    log('uv done')
    # part id as a colour attribute (for the bake)
    me = low.data
    ca = me.color_attributes.new('partcol', 'FLOAT_COLOR', 'CORNER')
    li = np.empty(len(me.loops), np.int32)
    me.polygons.foreach_get('loop_total', np.empty(nf, np.int32))
    loop_face = np.repeat(np.arange(nf), [p.loop_total for p in me.polygons])
    cols = np.zeros((len(me.loops), 4), np.float32)
    cols[:, 0] = partf[loop_face] / 16.0
    cols[:, 3] = 1
    ca.data.foreach_set('color', cols.ravel())
    R = TEXRES
    pos = do_bake(low, high, bake_image('pos', R), 'EMIT', emit_position, extrusion=0.007, maxdist=0.016)
    pos_lo = do_bake(low, None, bake_image('poslo', R), 'EMIT', emit_position)
    part_lo = do_bake(low, None, bake_image('partlo', R), 'EMIT', emit_attr('partcol'))
    nrm = do_bake(low, None, bake_image('nrm', R), 'EMIT', emit_normal)
    prt = do_bake(low, high, bake_image('lab', R), 'EMIT', emit_attr('lab'), extrusion=0.007, maxdist=0.016)
    sc.cycles.samples = 1
    nmap = do_bake(low, high, bake_image('nmap', R), 'NORMAL', samples=1, extrusion=0.007, maxdist=0.016)
    # occlusion of the low mesh itself (with the dense mesh in the scene, each surface would shadow the other one, almost coincident)
    high.hide_render = True
    sc.world = sc.world or bpy.data.worlds.new('w')
    sc.world.light_settings.distance = 0.25
    ao = do_bake(low, None, bake_image('ao', R // 2), 'AO', samples=16 if FAST else 32)
    high.hide_render = False
    ao = np.repeat(np.repeat(ao, 2, 0), 2, 1)
    bpy.data.objects.remove(high)
    log('bakes done')
    alb, orm, em, nimg, skm, has_em = synth(d, trees_by_part, part_names, pos, nrm, prt, ao, nmap, pos_lo, part_lo)
    log('textures done', [ (float(np.nanmin(x)), float(np.nanmax(x)), int(np.isnan(x).sum())) for x in (alb, orm, nimg)])
    TMP = os.path.join(TMPDIR, cid)
    os.makedirs(TMP, exist_ok=True)
    i_alb = save_image(cid + '_albedo', alb, os.path.join(TMP, cid + '_albedo.jpg'), quality=90)
    i_nrm = save_image(cid + '_normal', nimg, os.path.join(TMP, cid + '_normal.jpg'), quality=94, srgb=False)
    i_orm = save_image(cid + '_orm', orm, os.path.join(TMP, cid + '_orm.jpg'), quality=90, srgb=False)
    i_em = save_image(cid + '_emission', em, os.path.join(TMP, cid + '_emission.jpg'), quality=90) if has_em else None
    m_body = pbr_material(cid + '_body', i_alb, i_nrm, i_orm, i_em)
    m_skin = pbr_material(cid + '_skin', i_alb, i_nrm, i_orm, None)
    me.materials.clear()
    me.materials.append(m_body)
    me.materials.append(m_skin)
    matf = get_attr(low, 'mat', nf)
    skin_ids = [sdf.MATS[x] for x in d.skin_mats if x in sdf.MATS]
    me.polygons.foreach_set('material_index', np.isin(matf, skin_ids).astype(np.int32))
    # hair cards
    hair_ob = None
    if d.hair is not None:
        hair_ob = hair.build(d, OUT, log)
    # armature
    adata = bpy.data.armatures.new('CharacterArmature')
    arm = bpy.data.objects.new('CharacterArmature', adata)
    sc.collection.objects.link(arm)
    bl.select_only(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for (n, p, hd, tl, z) in sk.bones:
        e = adata.edit_bones.new(n)
        e.head, e.tail = Vector(hd), Vector(tl)
        e.align_roll(Vector(z))
        if p:
            e.parent = eb[p]
        eb[n] = e
    bpy.ops.object.mode_set(mode='OBJECT')
    # weights
    objs = [low] + ([hair_ob] if hair_ob is not None else [])
    reg_names = {v: k for k, v in sdf.REGS.items()}
    for ob in objs:
        Vt = bl.verts_of(ob)
        regs = get_attr(ob, 'reg', len(ob.data.vertices))
        W = rig.weights(sk, Vt, regs, reg_names, extra=lambda W, P, vb: rig.lid_jaw_fix(sk, W, P, vb))
        e = np.empty(len(ob.data.edges) * 2, np.int32)
        ob.data.edges.foreach_get('vertices', e)
        W = rig.smooth_on_mesh(W, e.reshape(-1, 2), ['Jaw', 'Lid.L', 'Lid.R'], n_iter=5)
        bi, ww = rig.top4(W, sk.names)
        groups = {}
        for b in sk.names:
            groups[b] = ob.vertex_groups.new(name=b)
        for j in range(4):
            for b_i in np.unique(bi[:, j]):
                sel = np.flatnonzero((bi[:, j] == b_i) & (ww[:, j] > 0))
                if len(sel) == 0:
                    continue
                g = groups[sk.names[b_i]]
                for wv in np.unique(np.round(ww[sel, j], 3)):
                    ids = sel[np.round(ww[sel, j], 3) == wv]
                    g.add(ids.tolist(), float(wv), 'REPLACE')
        mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
        ob.parent = arm
    # props: separate objects (the game hides them when seated)
    for i, (nm, *_r) in enumerate(specs):
        if not nm.startswith('Prop_'):
            continue
        bl.select_only(low)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')
        sel = (partf == i)
        low.data.polygons.foreach_set('select', sel)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        for o in bpy.context.selected_objects:
            if o != low:
                o.name = nm
                o.data.name = cid + '_' + nm
        partf = get_attr(low, 'part', len(low.data.polygons))
    fp_texture(d, OUT)
    tris = sum(bl.tri_count(o) for o in sc.objects if o.type == 'MESH')
    anims.make_actions(arm)
    path = os.path.join(OUT, cid + '.gltf')
    bl.select_only(arm)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLTF_SEPARATE', export_texture_dir='', export_image_format='AUTO',
        export_apply=False, export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_def_bones=False, export_yup=True,
        export_materials='EXPORT', export_tangents=True, export_cameras=False, export_lights=False, export_extras=False,
        export_force_sampling=True, export_optimize_animation_size=False, export_attributes=False, use_selection=False)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.startswith(cid + '.') or f.startswith(cid + '_'))
    log('BUILT %s tris %d size %.1f MB' % (cid, tris, size / 1e6))

for cid in designs.CHARS:
    if not ONLY or cid in ONLY:
        build(cid)
