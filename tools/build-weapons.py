# Assemble les modèles d'armes du port Godot (J15). Usage (Blender 5.x, sans scripts auto-exécutés) :
#   blender -b --disable-autoexec --python tools/build-weapons.py -- <dossier des packs> <dossier de sortie>
# Dossier des packs : x_small/ (Various Small Arms, Tabasco, CC-BY 3.0 : ak47 m4 dragunov m1911 .blend),
#                     x_kenney/ (Kenney Blaster Kit, CC0 : Models/GLB format/blaster-*.glb).
# Les modèles construits (Barrett M82, M79, arbalète) sont écrits ici en primitives (repère : canon +X, haut +Z, mètres réels).
# Sortie : OBJ + MTL (canon vers +X, haut +Y par la conversion standard de l'export, comme les OBJ de Quaternius). Les données des packs ne sont jamais exécutées.
import bpy, sys, math, os
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
PACKS, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1)
    m.diffuse_color = (rgb[0], rgb[1], rgb[2], 1)
    return m

def box(c, s, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c, rotation=rot)
    o = bpy.context.object
    o.scale = s
    o.data.materials.append(m)
    return o

def cyl(x0, x1, r, m, y=0.0, z=0.0, seg=14):
    """cylindre d'axe X de x0 à x1"""
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=abs(x1 - x0), location=((x0 + x1) / 2, y, z), rotation=(0, math.pi / 2, 0))
    o = bpy.context.object
    o.data.materials.append(m)
    return o

def finish(name, flat=True):
    """joint tout, applique les transformations, centre latéralement, exporte l'OBJ."""
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if flat:
        bpy.ops.object.shade_flat()
    # centrage latéral (Y Blender) sur le milieu de la boîte
    ys = [v.co.y for v in o.data.vertices]
    cy = (min(ys) + max(ys)) / 2
    for v in o.data.vertices:
        v.co.y -= cy
    path = os.path.join(OUT, name + '.obj')
    bpy.ops.wm.obj_export(filepath=path, export_materials=True, export_uv=False,
                          export_normals=True, apply_modifiers=True, global_scale=1.0, export_selected_objects=True)
    print('EXPORT', name, [round(d, 3) for d in o.dimensions])

def rot_z(o, deg):
    o.rotation_euler[2] = math.radians(deg)

# ---------- Tabasco (Various Small Arms, CC-BY 3.0) : une orientation propre par fichier ----------
# retouches de couleur (valeurs d'écran sRGB) : AK-47 bois moins jaune, chargeur du M4 sombre
RECOLOR = {'Tabasco_AK47': {1: (0.42, 0.25, 0.11)}, 'Tabasco_M4': {0: (0.22, 0.22, 0.23), 2: (0.14, 0.14, 0.15)}}

def tabasco(blend, name, zdeg, flipx=False):
    reset()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(PACKS, 'x_small', blend + '.blend'), load_ui=False)
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    o = [o for o in bpy.data.objects if o.type == 'MESH'][0]
    o.parent = None
    o.rotation_euler = (0, 0, math.radians(zdeg))
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for i, m in enumerate(o.data.materials):   # couleur de la vue = couleur diffuse du matériau d'origine
        m.use_nodes = True
        b = m.node_tree.nodes.get('Principled BSDF')
        if b:   # couleurs de 2008 en valeurs d'écran (sRGB) : converties en linéaire, blanc pur ramené à un gris métal
            c = list(RECOLOR.get(name, {}).get(i, [min(v, 0.6) if v > 0.8 else v for v in m.diffuse_color[:3]]))
            lin = [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c]
            b.inputs['Base Color'].default_value = (lin[0], lin[1], lin[2], 1)
    finish(name, flat=True)

# ---------- Kenney Blaster Kit (CC0) : la palette (colormap) est cuite en matériaux unis ----------
def kenney(glb, name):
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(PACKS, 'x_kenney', 'Models', 'GLB format', glb + '.glb'))
    obs = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in obs:
        o.parent = None
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.rotation_mode = 'XYZ'
    o.rotation_euler = (0, 0, math.radians(-90))   # canon +Y -> +X
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    img = None
    for m in o.data.materials:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE':
                img = n.image
    w, h = img.size
    px = list(img.pixels)
    uv = o.data.uv_layers.active.data
    cache = {}
    o.data.materials.clear()
    for p in o.data.polygons:
        u = sum(uv[l].uv.x for l in p.loop_indices) / p.loop_total
        v = sum(uv[l].uv.y for l in p.loop_indices) / p.loop_total
        ix, iy = min(w - 1, max(0, int(u * w))), min(h - 1, max(0, int(v * h)))
        k = (iy * w + ix) * 4
        c = tuple(round(px[k + j], 2) for j in range(3))
        if c not in cache:
            cache[c] = len(cache)
            o.data.materials.append(mat('kenney_%d' % len(cache), c))
        p.material_index = cache[c]
    o.data.uv_layers.clear() if hasattr(o.data.uv_layers, 'clear') else None
    finish(name)

# ---------- modèles construits (mètres réels) ----------
def steel():  return mat('acier', (0.16, 0.17, 0.19))
def steel2(): return mat('acier_clair', (0.30, 0.31, 0.34))
def wood():   return mat('bois', (0.36, 0.20, 0.10))
def olive():  return mat('olive', (0.20, 0.24, 0.14))
def black():  return mat('noir', (0.06, 0.06, 0.07))
def glass():  return mat('verre', (0.10, 0.25, 0.35))

def barrett():
    reset(); s, s2, ol, bk = steel(), steel2(), olive(), black()
    box((0.30, 0, 0.02), (0.62, 0.07, 0.11), s)                       # boîtier
    box((0.10, 0, 0.085), (0.60, 0.04, 0.02), s2)                      # rail du dessus
    box((0.02, 0, -0.065), (0.10, 0.05, 0.07), bk, (0, math.radians(-12), 0))  # poignée
    box((0.34, 0, -0.09), (0.16, 0.06, 0.11), ol)                      # chargeur (sous l'avant du boîtier)
    box((-0.22, 0, 0.0), (0.46, 0.06, 0.10), bk)                       # crosse
    box((-0.46, 0, 0.0), (0.03, 0.07, 0.15), black())                  # plaque de couche
    box((-0.15, 0, 0.075), (0.22, 0.045, 0.03), bk)                    # joue
    cyl(0.55, 1.28, 0.022, s)                                          # canon
    cyl(0.60, 0.95, 0.032, s)                                          # manchon
    for i in range(3):
        box((1.31 + i * 0.045, 0, 0), (0.025, 0.075, 0.075), bk)       # frein de bouche à fentes
    cyl(1.30, 1.46, 0.019, bk)
    cyl(0.12, 0.52, 0.032, bk, z=0.145)                                # lunette
    cyl(0.07, 0.12, 0.042, bk, z=0.145); cyl(0.52, 0.58, 0.040, bk, z=0.145)
    box((0.20, 0, 0.115), (0.03, 0.03, 0.05), s2); box((0.42, 0, 0.115), (0.03, 0.03, 0.05), s2)
    for sy in (-1, 1):                                                 # bipied replié
        box((0.78, sy * 0.045, -0.06), (0.35, 0.012, 0.012), s2, (0, math.radians(8), 0))
    finish('Barrett')

def m79():
    reset(); s, wd, bk = steel(), wood(), black()
    box((-0.17, 0, -0.02), (0.36, 0.045, 0.075), wd, (0, math.radians(-6), 0))   # crosse
    box((-0.355, 0, -0.04), (0.02, 0.05, 0.095), bk)
    box((0.04, 0, 0.0), (0.16, 0.05, 0.08), s)                                    # boîte de culasse
    box((0.03, 0, -0.065), (0.07, 0.03, 0.05), wd, (0, math.radians(-14), 0))      # poignée
    box((0.075, 0, -0.045), (0.08, 0.012, 0.012), s)                              # pontet (traverse)
    cyl(0.10, 0.50, 0.022, s, seg=18)                                             # canon court cassant (40 mm)
    cyl(0.10, 0.24, 0.026, bk, seg=18)                                            # garde-main sombre
    box((0.30, 0, 0.0), (0.18, 0.05, 0.05), wd)                                   # garde-main bois
    box((0.45, 0, 0.03), (0.012, 0.012, 0.035), bk)                               # guidon
    box((0.06, 0, 0.055), (0.05, 0.018, 0.045), bk)                               # hausse
    box((0.52, 0, 0.0), (0.02, 0.05, 0.05), bk)
    finish('M79')

def crossbow():
    reset(); wd, bk, s, ol = wood(), black(), steel(), olive()
    box((-0.12, 0, -0.01), (0.46, 0.05, 0.07), wd)                                # fût
    box((-0.38, 0, -0.03), (0.09, 0.04, 0.09), wd)                                # crosse
    box((0.10, 0, 0.0), (0.38, 0.045, 0.06), wd)                                  # rail avant
    box((0.10, 0, 0.037), (0.46, 0.014, 0.014), s)                                # glissière
    box((-0.10, 0, -0.07), (0.05, 0.03, 0.09), wd, (0, math.radians(-12), 0))      # poignée
    box((0.30, 0, 0.0), (0.05, 0.12, 0.05), bk)                                   # centre de l'arc
    for sy in (-1, 1):                                                            # branches de l'arc
        box((0.28, sy * 0.12, 0.0), (0.05, 0.17, 0.02), bk, (0, 0, sy * math.radians(-14)))
        box((0.24, sy * 0.21, 0.0), (0.04, 0.08, 0.02), bk, (0, 0, sy * math.radians(-30)))
    for sy in (-1, 1):                                                            # corde
        box((0.08, sy * 0.12, 0.037), (0.24, 0.004, 0.004), steel2(), (0, 0, sy * math.radians(-30)))
    cyl(-0.08, 0.40, 0.007, mat('trait', (0.55, 0.5, 0.4)), z=0.050)              # carreau
    box((0.42, 0, 0.050), (0.04, 0.02, 0.02), s)
    box((0.03, 0, 0.065), (0.08, 0.02, 0.025), bk)                                # hausse
    box((0.34, 0, 0.065), (0.03, 0.02, 0.04), bk)
    box((0.31, 0, 0.0), (0.02, 0.07, 0.06), bk) if False else None
    finish('Crossbow')

for f, n, z in (('ak47', 'Tabasco_AK47', 180), ('m4', 'Tabasco_M4', 180), ('dragunov', 'Tabasco_Dragunov', -90), ('m1911', 'Tabasco_M1911', 90)):
    tabasco(f, n, z)
kenney('blaster-r', 'Kenney_Raygun')
barrett(); m79(); crossbow()
