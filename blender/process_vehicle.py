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
    p.add_argument("--separate-loose", action="store_true", help="divide le mesh in parti sciolte (componenti)")
    p.add_argument("--bake", type=int, default=0, help="cuoce colori e texture in un atlas di N px (0 = no)")
    p.add_argument("--convert-only", action="store_true", help="solo importazione ed export GLB")
    return p.parse_args(argv)


def import_any(path):
    """Importa GLB/glTF, FBX, OBJ, STL o apre un .blend."""
    low = path.lower()
    if low.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=path)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if low.endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=path)
    elif low.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    elif low.endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=path)
    elif low.endswith(".stl"):
        bpy.ops.wm.stl_import(filepath=path)
    else:
        raise SystemExit(f"Formato non supportato: {path}")


def bake_atlas(meshes, size):
    """Cuoce il colore base (texture + colori materiali) di tutte le mesh in un unico atlas."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # nuova UV per l'atlas, senza toccare quelle originali usate dai materiali
    uv_src = obj.data.uv_layers.active
    atlas_uv = obj.data.uv_layers.new(name="atlas")
    obj.data.uv_layers.active = atlas_uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("atlas", width=size, height=size, alpha=False)
    # Si cuoce il "Base Color" (texture comprese) tramite un'emissione temporanea:
    # un bake DIFFUSE darebbe nero sui materiali metallici (albedo diffusa nulla).
    for slot in obj.material_slots:
        mat = slot.material
        if not mat:
            continue
        mat.use_nodes = True
        nt = mat.node_tree
        nodes = nt.nodes
        if uv_src is not None:
            for node in list(nodes):
                if node.type == "TEX_IMAGE":
                    uvn = nodes.new("ShaderNodeUVMap")
                    uvn.uv_map = uv_src.name
                    nt.links.new(uvn.outputs["UV"], node.inputs["Vector"])
        out = next((nd for nd in nodes if nd.type == "OUTPUT_MATERIAL"), None) or nodes.new("ShaderNodeOutputMaterial")
        bsdf = next((nd for nd in nodes if nd.type == "BSDF_PRINCIPLED"), None)
        emit = nodes.new("ShaderNodeEmission")
        if bsdf is not None:
            base = bsdf.inputs["Base Color"]
            if base.is_linked:
                nt.links.new(base.links[0].from_socket, emit.inputs["Color"])
            else:
                emit.inputs["Color"].default_value = base.default_value
        else:
            emit.inputs["Color"].default_value = (0.6, 0.6, 0.6, 1.0)
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
        n = nodes.new("ShaderNodeTexImage")
        n.image = img
        nodes.active = n
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    bpy.ops.object.bake(type="EMIT", margin=4, use_clear=True, uv_layer="atlas")
    # materiale unico con l'atlas
    m = bpy.data.materials.new("Atlas")
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.6
    obj.data.materials.clear()
    obj.data.materials.append(m)
    # l'atlas diventa la sola UV
    for layer in [l for l in obj.data.uv_layers if l.name != "atlas"]:
        obj.data.uv_layers.remove(layer)
    img.pack()
    return [obj]


def tri_count(objs):
    n = 0
    for o in objs:
        for poly in o.data.polygons:
            n += len(poly.vertices) - 2
    return n


def main():
    a = parse_args()
    t0 = time.time()
    import_any(a.input)
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

    if a.convert_only:
        bpy.ops.export_scene.gltf(filepath=a.output, export_format="GLB", export_apply=True, export_yup=True)
        print(json.dumps({"ok": True, "blender": bpy.app.version_string, "objects": len(meshes), "triangles": tri_count(meshes), "converted": True}))
        return

    separated = 0
    if a.separate_loose:
        for o in list(meshes):
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.mesh.separate(type="LOOSE")
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        separated = len(meshes)

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
    baked = 0
    if a.bake:
        meshes = bake_atlas(meshes, a.bake)
        baked = a.bake

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
        "separated_parts": separated,
        "baked_atlas_px": baked,
        "seconds": round(time.time() - t0, 2),
    }))


if __name__ == "__main__":
    main()
