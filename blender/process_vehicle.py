"""
Vehicle3D AI – pulizia e ottimizzazione mesh con Blender.

Uso:
  blender -b -P blender/process_vehicle.py -- input.glb output.glb [--target-tris 300000] [--obj output.obj]
  python blender/process_vehicle.py input.glb output.glb    (con il modulo `bpy` installato via pip)

Operazioni: import GLB, applicazione trasformazioni, unione vertici duplicati,
rimozione geometria degenere/isolata, ricalcolo normali verso l'esterno,
decimazione fino al numero di triangoli richiesto, export GLB (e OBJ opzionale).
Stampa un report JSON sull'ultima riga di stdout.
"""
import argparse
import json
import sys
import time

import bpy  # deve precedere bmesh quando si usa il modulo bpy da pip
import bmesh  # noqa: E402


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--target-tris", type=int, default=300000)
    p.add_argument("--merge-distance", type=float, default=0.0001, help="relativa alla diagonale del modello")
    p.add_argument("--obj", default=None)
    return p.parse_args(argv)


def tri_count(objs):
    n = 0
    for o in objs:
        for poly in o.data.polygons:
            n += len(poly.vertices) - 2
    return n


def main():
    a = parse_args()
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.input)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("Nessuna mesh nel file")
    before = tri_count(meshes)

    # applica le trasformazioni (anche dei genitori) alle mesh
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # diagonale per tolleranze relative
    xs, ys, zs = [], [], []
    for o in meshes:
        for v in o.data.vertices:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)
    diag = ((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2 + (max(zs) - min(zs)) ** 2) ** 0.5
    merge_dist = max(diag * a.merge_distance, 1e-7)

    merged = removed_loose = 0
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        n0 = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist)
        merged += n0 - len(bm.verts)
        bmesh.ops.dissolve_degenerate(bm, dist=merge_dist * 0.5, edges=bm.edges)
        loose = [v for v in bm.verts if not v.link_faces]
        removed_loose += len(loose)
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()

    mid = tri_count(meshes)
    ratio = 1.0
    if mid > a.target_tris:
        ratio = a.target_tris / mid
        for o in meshes:
            m = o.modifiers.new("Decimate", "DECIMATE")
            m.decimate_type = "COLLAPSE"
            m.ratio = ratio
            m.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
    after = tri_count(meshes)

    bpy.ops.export_scene.gltf(filepath=a.output, export_format="GLB", export_apply=True, export_yup=True)
    if a.obj:
        bpy.ops.wm.obj_export(filepath=a.obj, export_materials=True, forward_axis="NEGATIVE_Z", up_axis="Y")

    print(json.dumps({
        "ok": True,
        "blender": bpy.app.version_string,
        "objects": len(meshes),
        "triangles_before": before,
        "triangles_after_cleanup": mid,
        "triangles_after": after,
        "decimate_ratio": round(ratio, 4),
        "merged_vertices": merged,
        "removed_loose_vertices": removed_loose,
        "seconds": round(time.time() - t0, 2),
    }))


if __name__ == "__main__":
    main()
