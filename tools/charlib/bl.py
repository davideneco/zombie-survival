# Blender helpers for the character build (v0.31.0): fast mesh creation from numpy arrays, decimation, UVs, bakes and preview renders.
import bpy, bmesh
import numpy as np

def new_mesh(name, verts, tris=None, quads=None, obj_name=None, link=True):
    """Mesh object from numpy arrays (vertices (N, 3), triangles (T, 3), quads (Q, 4))."""
    tris = np.zeros((0, 3), np.int64) if tris is None else np.asarray(tris)
    quads = np.zeros((0, 4), np.int64) if quads is None else np.asarray(quads)
    me = bpy.data.meshes.new(name)
    nv = len(verts)
    me.vertices.add(nv)
    me.vertices.foreach_set('co', np.asarray(verts, np.float32).ravel())
    loops = np.concatenate([tris.ravel(), quads.ravel()]).astype(np.int32)
    sizes = np.concatenate([np.full(len(tris), 3), np.full(len(quads), 4)]).astype(np.int32)
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32)
    me.loops.add(len(loops))
    me.loops.foreach_set('vertex_index', loops)
    me.polygons.add(len(sizes))
    me.polygons.foreach_set('loop_start', starts)
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    ob = bpy.data.objects.new(obj_name or name, me)
    if link:
        bpy.context.scene.collection.objects.link(ob)
    return ob

def verts_of(ob):
    me = ob.data
    a = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3).astype(np.float64)

def set_verts(ob, co):
    ob.data.vertices.foreach_set('co', np.asarray(co, np.float32).ravel())
    ob.data.update()

def tri_count(ob):
    me = ob.data
    n = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_total', n)
    return int((n - 2).sum())

def select_only(*obs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]

def decimate(ob, target_tris, vgroup=None, vfactor=1.0):
    t = tri_count(ob)
    if t <= target_tris:
        return
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target_tris / t
    m.use_collapse_triangulate = True
    if vgroup:
        m.vertex_group = vgroup
        m.vertex_group_factor = vfactor
    select_only(ob)
    bpy.ops.object.modifier_apply(modifier=m.name)

def shade_smooth(ob, angle_deg=None):
    me = ob.data
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    me.update()
    if angle_deg is not None:
        select_only(ob)
        bpy.ops.object.shade_smooth_by_angle(angle=np.radians(angle_deg), keep_sharp_edges=True)

def smart_uv(ob, margin=0.004, angle=66.0, weights=None):
    """Smart UV project; weights (per face, optional) scales islands up (more texels on the face and hands) before packing."""
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=np.radians(angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    if weights is not None:
        scale_islands(ob, weights)
        select_only(ob)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, scale=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
        bpy.ops.object.mode_set(mode='OBJECT')

def scale_islands(ob, face_w):
    """Scales each UV island around its centre by the mean weight of its faces."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    # islands: faces connected through shared UV coordinates
    seen = set()
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        stack = [f0]; island = []
        seen.add(f0.index)
        while stack:
            f = stack.pop(); island.append(f)
            for l in f.loops:
                for e_l in (l, l.link_loop_prev):
                    e = e_l.edge
                    for f2 in e.link_faces:
                        if f2.index in seen:
                            continue
                        # same UVs on both sides of the edge -> same island
                        a = [lp for lp in f2.loops if lp.vert == e.verts[0]]
                        b = [lp for lp in f.loops if lp.vert == e.verts[0]]
                        if a and b and (a[0][uv].uv - b[0][uv].uv).length < 1e-6:
                            a2 = [lp for lp in f2.loops if lp.vert == e.verts[1]]
                            b2 = [lp for lp in f.loops if lp.vert == e.verts[1]]
                            if a2 and b2 and (a2[0][uv].uv - b2[0][uv].uv).length < 1e-6:
                                seen.add(f2.index); stack.append(f2)
        w = float(np.mean([face_w[f.index] for f in island]))
        if abs(w - 1.0) < 1e-3:
            continue
        cs = [l[uv].uv.copy() for f in island for l in f.loops]
        c = sum(cs, cs[0] * 0) / len(cs)
        for f in island:
            for l in f.loops:
                l[uv].uv = c + (l[uv].uv - c) * w
    bm.to_mesh(ob.data)
    bm.free()
