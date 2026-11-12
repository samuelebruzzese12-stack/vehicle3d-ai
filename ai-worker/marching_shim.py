"""Se torchmcubes (estensione C++ da compilare) non è installato, lo sostituisce con scikit-image."""
import sys
import types

try:
    import torchmcubes  # noqa: F401
except ImportError:
    import numpy as np
    import torch
    from skimage import measure

    def marching_cubes(vol, threshold):
        v = vol.detach().cpu().numpy()
        verts, faces, _, _ = measure.marching_cubes(v, level=float(threshold))
        # torchmcubes restituisce le coordinate in ordine (x, y, z) invertito rispetto a skimage
        verts = verts[:, ::-1].copy()
        return torch.from_numpy(verts.astype(np.float32)), torch.from_numpy(faces.astype(np.int64))

    mod = types.ModuleType("torchmcubes")
    mod.marching_cubes = marching_cubes
    sys.modules["torchmcubes"] = mod
