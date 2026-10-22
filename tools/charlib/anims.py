# Animations of the playable characters (v0.31.0), written as bone rotations (degrees) and sampled into Blender actions.
# Same clips as v0.21-v0.25 (Idle, Walk, Run, Sit_Moto, Sit_Bike, Sit_Tram, Sit_Tram_Drive, Death, Jump), retargeted to the extended skeleton
# (hands and fingers: relaxed, gripping the handlebars or the tram controller, open when falling) and a new Sprint.
# Body bones rotate in armature space (the axes of the old script, so the clips keep their look); fingers rotate about their own X axis
# (charlib/skel.py rolls them so that + flexes). Eyes, lids and jaw are not keyed: scenes/face_rig.gd moves them (blink, gaze).
import math
import bpy
from mathutils import Matrix, Vector, Quaternion

def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 3, axis)

FINGER = {
    'relax': {'Index': (10, 16, 9), 'Middle': (13, 20, 11), 'Ring': (16, 23, 13), 'Pinky': (20, 26, 15), 'Thumb': (6, 10, 8)},
    'loose': {'Index': (5, 8, 5), 'Middle': (6, 10, 6), 'Ring': (8, 12, 7), 'Pinky': (10, 14, 8), 'Thumb': (3, 5, 4)},
    'grip': {'Index': (62, 78, 40), 'Middle': (68, 82, 42), 'Ring': (72, 84, 44), 'Pinky': (76, 86, 46), 'Thumb': (22, 30, 26)},
    'fist': {'Index': (82, 95, 55), 'Middle': (86, 98, 55), 'Ring': (88, 98, 55), 'Pinky': (90, 98, 55), 'Thumb': (30, 40, 35)},
    'open': {'Index': (2, 3, 2), 'Middle': (3, 4, 2), 'Ring': (4, 5, 3), 'Pinky': (6, 6, 4), 'Thumb': (0, 2, 2)},
}

def hand(side, preset, k=1.0, P=None):
    P = {} if P is None else P
    for f, angs in FINGER[preset].items():
        for i, a in enumerate(angs):
            P['%s%d.%s' % (f, i + 1, side)] = dict(local=a * k)
    return P

def both(preset, k=1.0, P=None):
    P = hand('L', preset, k, P)
    return hand('R', preset, k, P)

def walk_pose(ph, A_, K, Bsw, elbow, lean, twist, sprint=False):
    s = math.sin(ph)
    P = {}
    for side, sg in (('L', 1), ('R', -1)):
        sp = math.sin(ph + (0 if sg == 1 else math.pi)); cp = math.cos(ph + (0 if sg == 1 else math.pi))
        P['UpperLeg.' + side] = dict(rotx=-A_ * sp)
        P['LowerLeg.' + side] = dict(rotx=K * max(0.0, cp) + 4)
        P['Foot.' + side] = dict(rotx=A_ * sp * 0.5 - K * max(0.0, cp) * 0.3)
        P['Toe.' + side] = dict(rotx=-12 * max(0.0, -sp) if not sprint else -20 * max(0.0, -sp))
        P['UpperArm.' + side] = dict(rotx=Bsw * sp, roty=(-6 if sg == 1 else 6))
        P['LowerArm.' + side] = dict(rotx=-elbow - 8 * max(0.0, -sp))
    P['Abdomen'] = dict(rotx=lean * 0.5, rotz=twist * s)
    P['Torso'] = dict(rotx=lean * 0.5, rotz=twist * s * 0.6)
    P['Head'] = dict(rotx=-lean * 0.7, rotz=-twist * s * 0.6)
    P['Hips'] = dict(rotz=-twist * s * 0.6)
    both('relax' if not sprint else 'grip', 1.0 if not sprint else 0.6, P)
    return P

def anim_pose(name, t):
    ph = math.tau * t
    s = math.sin(ph)
    if name == 'Idle':
        P = {'Torso': dict(rotx=1.4 * s), 'Abdomen': dict(rotx=0.6 * s), 'Head': dict(rotx=-1.2 * s, rotz=1.5 * math.sin(ph * 0.5)),
             'Shoulder.L': dict(roty=-1.1 * s), 'Shoulder.R': dict(roty=1.1 * s),
             'UpperArm.L': dict(rotx=2 * s, roty=-3), 'UpperArm.R': dict(rotx=2 * s, roty=3),
             'LowerArm.L': dict(rotx=-12 - 2 * s), 'LowerArm.R': dict(rotx=-12 - 2 * s),
             'Hand.L': dict(roty=-4), 'Hand.R': dict(roty=4),
             'UpperLeg.L': dict(roty=-1.5), 'UpperLeg.R': dict(roty=1.5), 'Hips': dict(rotz=1.0 * math.sin(ph * 0.5))}
        return both('relax', 1.0 + 0.08 * s, P)
    if name == 'Walk':
        return walk_pose(ph, 28, 44, 24, 18, 4, 5)
    if name == 'Run':
        return walk_pose(ph, 52, 88, 48, 82, 14, 8)
    if name == 'Sprint':
        P = walk_pose(ph, 60, 100, 62, 92, 22, 10, sprint=True)
        return P
    if name in ('Sit_Moto', 'Sit_Bike'):
        moto = name == 'Sit_Moto'
        th = -62 if moto else -52
        kn = 78 if moto else 70
        P = {'Abdomen': dict(rotx=11 + 0.5 * s), 'Torso': dict(rotx=(20 if moto else 24) + 0.5 * s), 'Head': dict(rotx=-26 - 0.4 * s),
             'UpperLeg.L': dict(rotx=th, roty=-6), 'UpperLeg.R': dict(rotx=th, roty=6),
             'LowerLeg.L': dict(rotx=kn), 'LowerLeg.R': dict(rotx=kn),
             'Foot.L': dict(rotx=-(th + kn) * 0.8), 'Foot.R': dict(rotx=-(th + kn) * 0.8),
             'UpperArm.L': dict(rotx=-70 if moto else -66, roty=-4), 'UpperArm.R': dict(rotx=-70 if moto else -66, roty=4),
             'LowerArm.L': dict(rotx=-22), 'LowerArm.R': dict(rotx=-22),
             'Hand.L': dict(rotx=-8, rotz=-70), 'Hand.R': dict(rotx=-8, rotz=70)}
        return both('grip', 1.0, P)
    if name in ('Sit_Tram', 'Sit_Tram_Drive'):
        drive = name == 'Sit_Tram_Drive'
        P = {'Abdomen': dict(rotx=2 + 0.4 * s), 'Torso': dict(rotx=3 + 0.4 * s), 'Head': dict(rotx=-3 - 0.3 * s),
             'UpperLeg.L': dict(rotx=-90, roty=-5), 'UpperLeg.R': dict(rotx=-90, roty=5),
             'LowerLeg.L': dict(rotx=88), 'LowerLeg.R': dict(rotx=88),
             'Foot.L': dict(rotx=-2), 'Foot.R': dict(rotx=-2),
             'UpperArm.L': dict(rotx=-48 if drive else -28, roty=-2), 'UpperArm.R': dict(rotx=-48 if drive else -28, roty=2),
             'LowerArm.L': dict(rotx=-58 if drive else -68), 'LowerArm.R': dict(rotx=-58 if drive else -68)}
        if drive:
            P['Hand.L'] = dict(rotz=-60); P['Hand.R'] = dict(rotz=60)
            return both('grip', 0.85, P)
        P['Hand.L'] = dict(rotx=-10); P['Hand.R'] = dict(rotx=-10)
        return both('relax', 1.2, P)
    if name == 'Jump':
        P = {'Abdomen': dict(rotx=3 + 0.8 * s), 'Torso': dict(rotx=5 + 0.8 * s), 'Head': dict(rotx=-5 - 0.6 * s),
             'UpperLeg.L': dict(rotx=-48 - 2 * s, roty=-5), 'UpperLeg.R': dict(rotx=-14 + 2 * s, roty=5),
             'LowerLeg.L': dict(rotx=70), 'LowerLeg.R': dict(rotx=28),
             'Foot.L': dict(rotx=-22), 'Foot.R': dict(rotx=-6),
             'UpperArm.L': dict(rotx=-38 - 3 * s, roty=-16), 'UpperArm.R': dict(rotx=-26 + 3 * s, roty=16),
             'LowerArm.L': dict(rotx=-42), 'LowerArm.R': dict(rotx=-36)}
        return both('loose', 1.0, P)
    if name == 'Death':
        u = min(1.0, t / 0.8)
        e = u * u * (3 - 2 * u)
        P = {'Root': dict(rotx=-92 * e, loc=(0, 0, 0.12 * e)),
             'Head': dict(rotx=-8 * e, rotz=18 * e), 'UpperArm.L': dict(roty=-52 * e, rotx=-10 * e), 'UpperArm.R': dict(roty=52 * e, rotx=-10 * e),
             'LowerArm.L': dict(rotx=-12 * e), 'LowerArm.R': dict(rotx=-12 * e),
             'UpperLeg.L': dict(roty=-9 * e), 'UpperLeg.R': dict(roty=9 * e), 'LowerLeg.L': dict(rotx=8 * e)}
        return both('relax', 1.0 - 0.6 * e, P)
    return {}

ANIMS = {  # name -> (frames, fps)
    'Idle': (48, 24), 'Walk': (28, 24), 'Run': (18, 24), 'Sprint': (16, 24), 'Sit_Moto': (48, 24), 'Sit_Bike': (48, 24), 'Sit_Tram': (48, 24),
    'Sit_Tram_Drive': (48, 24), 'Death': (24, 24), 'Jump': (48, 24),
}
NOT_KEYED = ('Eye.', 'Lid.', 'Jaw')

def pose_set(arm, name, kw):
    pb = arm.pose.bones[name]
    pb.rotation_mode = 'QUATERNION'
    if 'local' in kw:
        pb.rotation_quaternion = Quaternion((1, 0, 0), math.radians(kw['local']))
        pb.location = (0, 0, 0)
        return
    rest = pb.bone.matrix_local.to_3x3()
    D = R('Z', kw.get('rotz', 0.0)) @ R('Y', kw.get('roty', 0.0)) @ R('X', kw.get('rotx', 0.0))
    pb.rotation_quaternion = (rest.inverted() @ D @ rest).to_quaternion()
    loc = kw.get('loc')
    pb.location = (rest.inverted() @ Vector(loc)) if loc else (0, 0, 0)

STANDING = ('Idle', 'Walk', 'Run', 'Sprint', 'Jump')

def make_actions(arm):
    arm.animation_data_create()
    keyed = [pb for pb in arm.pose.bones if not pb.name.startswith(NOT_KEYED)]
    # the rest pose holds the arms a little away from the body (charlib/skel.py arm_out): standing clips bring them back towards the body
    ua = arm.data.bones['UpperArm.L']
    v = ua.tail_local - ua.head_local
    comp = max(0.0, math.degrees(math.atan2(abs(v.x), abs(v.z))) - 8.0)
    for name, (n, fps) in ANIMS.items():
        act = bpy.data.actions.new(name)
        arm.animation_data.action = act
        loop = name != 'Death'
        frames = list(range(0, n + 1, 2)) if loop else [0, 4, 8, 12, 16, 20, 23]
        for f in frames:
            t = (f % n) / n if loop else f / (n - 1)
            P = anim_pose(name, t)
            if name in STANDING and comp > 0:
                for b, sg in (('UpperArm.L', 1), ('UpperArm.R', -1)):
                    kw = dict(P.get(b, {}))
                    kw['roty'] = kw.get('roty', 0.0) + sg * comp
                    P[b] = kw
            for pb in keyed:
                pose_set(arm, pb.name, P.get(pb.name, {}))
                pb.keyframe_insert('rotation_quaternion', frame=f + 1)
                if pb.name == 'Root':
                    pb.keyframe_insert('location', frame=f + 1)
        act.use_frame_range = True
        act.frame_start = 1
        act.frame_end = n + 1 if loop else 24
        act.use_cyclic = loop
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    arm.animation_data.action = None
