import { Document, type Material } from "@gltf-transform/core";

/** Importatore OBJ/MTL → glTF (poligoni triangolati a ventaglio, un primitivo per materiale). */
export function objToDocument(objText: string, files: Map<string, Uint8Array> = new Map()): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("Scene");
  const v: number[][] = [], vt: number[][] = [], vn: number[][] = [];
  const groups = new Map<string, { p: number[]; uv: number[]; n: number[]; hasUv: boolean; hasN: boolean }>();
  let current = "default";
  const mtlLibs: string[] = [];
  const idx = (s: string, len: number) => { const i = parseInt(s, 10); return i < 0 ? len + i : i - 1; };

  for (const raw of objText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const [k, ...rest] = line.split(/\s+/);
    if (k === "v") v.push(rest.slice(0, 3).map(Number));
    else if (k === "vt") vt.push(rest.slice(0, 2).map(Number));
    else if (k === "vn") vn.push(rest.slice(0, 3).map(Number));
    else if (k === "usemtl") current = rest.join(" ");
    else if (k === "mtllib") mtlLibs.push(rest.join(" "));
    else if (k === "f" && rest.length >= 3) {
      let g = groups.get(current);
      if (!g) groups.set(current, (g = { p: [], uv: [], n: [], hasUv: true, hasN: true }));
      const corners = rest.map((c) => c.split("/"));
      for (let t = 1; t + 1 < corners.length; t++) {
        for (const c of [corners[0], corners[t], corners[t + 1]]) {
          const pi = idx(c[0], v.length);
          const p = v[pi];
          if (!p) throw new Error(`OBJ: indice vertice non valido (${c[0]})`);
          g.p.push(p[0], p[1], p[2]);
          if (c[1]) { const u = vt[idx(c[1], vt.length)] ?? [0, 0]; g.uv.push(u[0], 1 - u[1]); } else g.hasUv = false;
          if (c[2]) { const n = vn[idx(c[2], vn.length)] ?? [0, 1, 0]; g.n.push(n[0], n[1], n[2]); } else g.hasN = false;
        }
      }
    }
  }

  // materiali da MTL
  const mats = new Map<string, Material>();
  const dec = new TextDecoder();
  const find = (name: string) => {
    const base = name.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
    for (const [k, b] of files) if (k.toLowerCase().endsWith(base)) return b;
    return undefined;
  };
  for (const lib of mtlLibs) {
    const data = find(lib);
    if (!data) continue;
    let m: Material | null = null;
    for (const raw of dec.decode(data).split(/\r?\n/)) {
      const [k, ...rest] = raw.trim().split(/\s+/);
      if (k === "newmtl") { m = doc.createMaterial(rest.join(" ")).setRoughnessFactor(0.6).setMetallicFactor(0); mats.set(rest.join(" "), m); }
      else if (m && k === "Kd") { const c = rest.map(Number); m.setBaseColorFactor([c[0], c[1], c[2], m.getBaseColorFactor()[3]]); }
      else if (m && (k === "d" || k === "Tr")) {
        const a = k === "d" ? Number(rest[0]) : 1 - Number(rest[0]);
        if (a < 1) { const f = m.getBaseColorFactor(); m.setBaseColorFactor([f[0], f[1], f[2], a]).setAlphaMode("BLEND"); }
      } else if (m && k === "map_Kd") {
        const file = rest[rest.length - 1];
        const img = find(file);
        if (img) {
          const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
          m.setBaseColorTexture(doc.createTexture(file).setImage(img).setMimeType(mime).setURI(file.split(/[\\/]/).pop()!));
        }
      }
    }
  }

  const mesh = doc.createMesh("OBJ");
  for (const [name, g] of groups) {
    if (!g.p.length) continue;
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.p)).setBuffer(buffer))
      .setMaterial(mats.get(name) ?? doc.createMaterial(name).setBaseColorFactor([0.7, 0.7, 0.7, 1]));
    if (g.hasUv && g.uv.length === (g.p.length / 3) * 2) prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(g.uv)).setBuffer(buffer));
    if (g.hasN && g.n.length === g.p.length) prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.n)).setBuffer(buffer));
    mesh.addPrimitive(prim);
  }
  if (!mesh.listPrimitives().length) throw new Error("OBJ senza facce");
  scene.addChild(doc.createNode("OBJ").setMesh(mesh));
  return doc;
}
