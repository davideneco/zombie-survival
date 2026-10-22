# Narrow-band meshing of an SDF tree (charlib/sdf.py) with the OpenVDB module bundled with Blender (v0.31.0).
# 1. coarse grid (spacing C = h * coarse) evaluated everywhere in the tree's box;
# 2. bricks of 8 coarse cells: skipped when entirely outside, otherwise a dense fine grid (spacing h) is filled with the coarse values interpolated,
#    and the fine nodes of the cells near the surface (|d| < 2 C) are evaluated exactly;
# 3. the bricks are copied into a VDB FloatGrid (values clamped to +-band) and OpenVDB's volumeToMesh extracts the zero level set.
import numpy as np
import openvdb as vdb
from . import sdf

def _upsample(a, c):
    """Linear upsampling of a 3D array of node values by an integer factor c along each axis ((n-1)*c+1 nodes)."""
    for ax in range(3):
        a = np.moveaxis(a, ax, 0)
        n = a.shape[0]
        t = (np.arange(c) / c).reshape((c,) + (1,) * (a.ndim - 1))
        lo = a[:-1][:, None]
        hi = a[1:][:, None]
        mid = (lo * (1 - t[None]) + hi * t[None]).reshape(((n - 1) * c,) + a.shape[1:])
        a = np.concatenate([mid, a[-1:]], axis=0)
        a = np.moveaxis(a, 0, ax)
    return a

def mesh(root, h=0.002, coarse=4, adaptivity=0.0, lo=None, hi=None, log=print):
    C = h * coarse
    lo = root.lo + sdf.MARGIN * 0.5 if lo is None else np.asarray(lo)
    hi = root.hi - sdf.MARGIN * 0.5 if hi is None else np.asarray(hi)
    I0 = np.floor(lo / C).astype(int) - 1
    I1 = np.ceil(hi / C).astype(int) + 1
    nc = I1 - I0 + 1
    B = 8                                     # coarse cells per brick side
    nb = np.ceil((nc - 1) / B).astype(int)
    nc = nb * B + 1
    gx, gy, gz = [(I0[a] + np.arange(nc[a])) * C for a in range(3)]
    Pc = np.stack(np.meshgrid(gx, gy, gz, indexing='ij'), axis=-1).reshape(-1, 3)
    Dc = sdf.evaluate(root, Pc, brick=B * C)[0].reshape(tuple(nc))
    thr = 2.0 * C
    band = 3.0 * h
    grid = vdb.FloatGrid(band)
    grid.transform = vdb.createLinearTransform(voxelSize=h)
    nfine = 0
    nbr = 0
    for bi in range(nb[0]):
        for bj in range(nb[1]):
            for bk in range(nb[2]):
                sl = (slice(bi * B, bi * B + B + 1), slice(bj * B, bj * B + B + 1), slice(bk * B, bk * B + B + 1))
                blk = Dc[sl]
                if blk.min() > thr:
                    continue                  # entirely outside
                nbr += 1
                fine = _upsample(blk, coarse)
                if np.abs(blk).min() < thr:
                    # cells near the surface (any corner within thr), expanded by one cell
                    cm = np.minimum.reduce([np.abs(blk[a:a + B, b:b + B, c:c + B]) for a in (0, 1) for b in (0, 1) for c in (0, 1)]) < thr
                    if cm.any():
                        cme = cm.copy()
                        for ax in range(3):
                            cme = cme | np.roll(cme, 1, ax) | np.roll(cme, -1, ax)
                        fm = np.repeat(np.repeat(np.repeat(cme, coarse, 0), coarse, 1), coarse, 2)
                        fm = np.pad(fm, ((0, 1), (0, 1), (0, 1)), mode='edge')
                        idx = np.argwhere(fm)
                        base = (I0 + np.array([bi, bj, bk]) * B) * coarse
                        P = (base + idx) * h
                        d = root.ev(P, P.min(axis=0), P.max(axis=0))[0]
                        fine[idx[:, 0], idx[:, 1], idx[:, 2]] = d
                        nfine += len(idx)
                fine = np.ascontiguousarray(np.clip(fine, -band, band), dtype=np.float32)
                ijk = tuple(int(x) for x in (I0 + np.array([bi, bj, bk]) * B) * coarse)
                grid.copyFromArray(fine, ijk=ijk, tolerance=band * 0.001)
    log('  sdf: %d coarse nodes, %d bricks, %d fine evaluations' % (Pc.shape[0], nbr, nfine))
    pts, tris, quads = grid.convertToPolygons(isovalue=0.0, adaptivity=adaptivity)
    return np.asarray(pts, dtype=np.float64), np.asarray(tris, dtype=np.int64), np.asarray(quads, dtype=np.int64)
