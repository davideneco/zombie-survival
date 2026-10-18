# Prepare les modèles de zombies du port Godot (J16). Usage (Blender 5.x, sans scripts auto-exécutés) :
#   blender -b --disable-autoexec --python tools/build-zombies.py -- <dossier du pack glTF> <dossier de sortie>
# Dossier du pack : Zombie_Basic.gltf, Zombie_Chubby.gltf, Zombie_Arm.gltf (+ Zombie_Atlas.png) du « Zombie Apocalypse Kit » de Quaternius.
# Pour chaque modèle utile : supprime l'Icosphere parasite et les animations inutilisées (Wave, Yes, No, Jump_Idle, Jump_Land, Run_Arms...),
# retire des animations les doigts, la langue, les paupières et les os PoleTarget (60 % des pistes, inutiles de loin), sépare la tête du corps
# (objets « Head_* » : le jeu les cache quand la tête explose), exporte un seul .glb avec l'atlas 512 embarqué.
# Les données du pack ne sont jamais exécutées (importeur glTF seulement).
import bpy, sys, os

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)

KEEP = {'Idle', 'Walk', 'Run', 'Run_Attack', 'Punch', 'Idle_Attack', 'Death', 'HitReact', 'Jump', 'Crawl'}
DROP_BONES = ('Pinky', 'Middle', 'Index', 'Thumb', 'Tongue', 'Eyelid', 'PoleTarget', 'TopMouth', 'BottomMouth')
HEAD_GROUPS = ('Head', 'Eyelid.L', 'Eyelid.R', 'Tongue1', 'Tongue2', 'Tongue3', 'Tongue4', 'Tongue5', 'TopMouth', 'BottomMouth')
# variante -> (fichier, [animations gardées en plus])
MODELS = {'basic': 'Zombie_Basic.gltf', 'chubby': 'Zombie_Chubby.gltf', 'arm': 'Zombie_Arm.gltf'}

def action_name(a):
    return a.name.split('|')[-1]

def all_fcurves(a):
    out = []
    for layer in a.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.append(cb)
    return out

def prune_action(a):
    n = 0
    for cb in all_fcurves(a):
        for fc in list(cb.fcurves):
            if any(('"%s' % b) in fc.data_path for b in DROP_BONES):
                cb.fcurves.remove(fc)
                n += 1
    return n

def split_head(obj):
    """Sépare les sommets dominés par les groupes de tête dans un nouvel objet Head_Skull."""
    import bmesh
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='OBJECT')
    gidx = {g.index for g in obj.vertex_groups if g.name in HEAD_GROUPS}
    me = obj.data
    sel = 0
    for v in me.vertices:
        w = sum(g.weight for g in v.groups if g.group in gidx)
        tot = sum(g.weight for g in v.groups) or 1.0
        v.select = (w / tot) > 0.5
        sel += int(v.select)
    for p in me.polygons:
        p.select = all(me.vertices[i].select for i in p.vertices)
    for e in me.edges:
        e.select = all(me.vertices[i].select for i in e.vertices)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    return sel

for key, fn in MODELS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, fn))
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    body = max(meshes, key=lambda o: len(o.data.polygons))
    for o in meshes:
        if o is not body:
            o.name = 'Head_' + o.name   # Eyelid, Face, Tongue : pièces de la tête
    n = split_head(body)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o is not body and not o.name.startswith('Head_'):
            o.name = 'Head_Skull'
    body.name = 'Body'
    pr = 0
    for a in list(bpy.data.actions):
        if action_name(a) not in KEEP:
            bpy.data.actions.remove(a)
        else:
            pr += prune_action(a)
            a.name = action_name(a)
    print('MODEL', key, 'head verts', n, 'pruned fcurves', pr, 'actions', sorted(a.name for a in bpy.data.actions))
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'zombie_%s.glb' % key), export_format='GLB', export_animations=True,
        export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=True, export_yup=True,
        export_image_format='AUTO', export_apply=False, use_selection=False, export_cameras=False, export_lights=False,
        export_extras=False)
