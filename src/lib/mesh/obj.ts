import "server-only";
import { type Document, type Material, type Node } from "@gltf-transform/core";
import JSZip from "jszip";

function mtlName(m: Material | null, i: number) {
  return (m?.getName() || `materiale_${i}`).replace(/[^A-Za-z0-9_-]/g, "_") + `_${i}`;
}

/** Esporta tutte le mesh (con trasformazioni dei nodi) in OBJ+MTL+texture, compresso in ZIP. */
export async function exportObjZip(doc: Document, baseName: string, extraFiles: Record<string, string> = {}) {
  const lines: string[] = [`# Vehicle3D AI – ${baseName}`, `mtllib ${baseName}.mtl`];
  const mtl: string[] = [`# Materiali Vehicle3D AI`];
  const zip = new JSZip();
  const mats = new Map<Material | null, string>();
  const texFiles = new Map<unknown, string>();
  let vOff = 1, tOff = 1, nOff = 1, faces = 0, verts = 0;

  const matFor = (m: Material | null) => {
    let name = mats.get(m);
    if (name) return name;
    name = mtlName(m, mats.size);
    mats.set(m, name);
    const f = m?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1];
    mtl.push(`newmtl ${name}`, `Kd ${f[0].toFixed(4)} ${f[1].toFixed(4)} ${f[2].toFixed(4)}`, `d ${f[3].toFixed(3)}`, `Ka 0 0 0`, `Ks 0.1 0.1 0.1`, `illum 2`);
    const tex = m?.getBaseColorTexture();
    if (tex?.getImage()) {
      let file = texFiles.get(tex);
      if (!file) {
        const ext = tex.getMimeType() === "image/png" ? "png" : tex.getMimeType() === "image/webp" ? "webp" : "jpg";
        file = `${baseName}_tex${texFiles.size}.${ext}`;
        texFiles.set(tex, file);
        zip.file(file, tex.getImage()!);
      }
      mtl.push(`map_Kd ${file}`);
    }
    mtl.push("");
    return name;
  };

  const visit = (node: Node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const M = node.getWorldMatrix();
      lines.push(`g ${node.getName().replace(/\s+/g, "_") || "parte"}`);
      for (const p of mesh.listPrimitives()) {
        if (p.getMode() !== 4) continue;
        const P = p.getAttribute("POSITION"), N = p.getAttribute("NORMAL"), UV = p.getAttribute("TEXCOORD_0");
        if (!P) continue;
        const v = [0, 0, 0];
        for (let i = 0; i < P.getCount(); i++) {
          P.getElement(i, v);
          const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12];
          const y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13];
          const z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
          lines.push(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`);
        }
        if (UV) for (let i = 0; i < UV.getCount(); i++) { UV.getElement(i, v); lines.push(`vt ${v[0].toFixed(5)} ${(1 - v[1]).toFixed(5)}`); }
        if (N) for (let i = 0; i < N.getCount(); i++) {
          N.getElement(i, v);
          const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2], y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2], z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2];
          const l = Math.hypot(x, y, z) || 1;
          lines.push(`vn ${(x / l).toFixed(4)} ${(y / l).toFixed(4)} ${(z / l).toFixed(4)}`);
        }
        lines.push(`usemtl ${matFor(p.getMaterial())}`);
        const idx = p.getIndices();
        const n = idx ? idx.getCount() : P.getCount();
        for (let i = 0; i + 2 < n; i += 3) {
          const tri = [0, 1, 2].map((c) => (idx ? idx.getScalar(i + c) : i + c));
          lines.push("f " + tri.map((k) => `${k + vOff}/${UV ? k + tOff : ""}/${N ? k + nOff : ""}`.replace(/\/\/$/, "").replace(/\/$/, "")).join(" "));
          faces++;
        }
        vOff += P.getCount();
        verts += P.getCount();
        if (UV) tOff += UV.getCount();
        if (N) nOff += N.getCount();
      }
    }
    node.listChildren().forEach(visit);
  };
  for (const scene of doc.getRoot().listScenes()) scene.listChildren().forEach(visit);

  const obj = lines.join("\n") + "\n";
  zip.file(`${baseName}.obj`, obj);
  zip.file(`${baseName}.mtl`, mtl.join("\n"));
  for (const [k, v] of Object.entries(extraFiles)) zip.file(k, v);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { zip: buf, faces, vertices: verts, materials: mats.size, textures: texFiles.size, objText: obj };
}
