import { Document } from "@gltf-transform/core";

/** STL (binario o ASCII) → glTF. STL non ha colori né UV: materiale neutro. Converte Z-up (tipico STL) in Y-up. */
export function stlToDocument(data: Uint8Array): Document {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pos: number[] = [];
  const isBinary = data.byteLength >= 84 && 84 + dv.getUint32(80, true) * 50 === data.byteLength;
  if (isBinary) {
    const n = dv.getUint32(80, true);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 3; k++) pos.push(dv.getFloat32(o + k * 12, true), dv.getFloat32(o + k * 12 + 8, true), -dv.getFloat32(o + k * 12 + 4, true));
    }
  } else {
    const text = new TextDecoder().decode(data);
    if (!/^\s*solid/i.test(text)) throw new Error("STL non valido");
    for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) pos.push(Number(m[1]), Number(m[3]), -Number(m[2]));
  }
  if (pos.length < 9 || pos.some((x) => !Number.isFinite(x))) throw new Error("STL senza triangoli validi");
  const doc = new Document();
  const buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buf))
    .setMaterial(doc.createMaterial("STL").setBaseColorFactor([0.55, 0.57, 0.5, 1]).setRoughnessFactor(0.7));
  doc.createScene("Scene").addChild(doc.createNode("STL").setMesh(doc.createMesh("STL").addPrimitive(prim)));
  return doc;
}
