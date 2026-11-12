import "server-only";
import { type Document, type Material, type Node } from "@gltf-transform/core";
import sharp from "sharp";
import { camoColor, camoTexture } from "./camo";
import { materialForPart, PRESETS, type Livery } from "./presets";

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Colore dei voxel Minecraft secondo la livrea.
 * Ritorna null per mantenere il colore campionato dal modello.
 */
export function voxelColorOverride(livery: Livery) {
  return (label: string, x: number, y: number, z: number): [number, number, number] | null => {
    const kind = materialForPart(label, livery);
    if (livery.mode === "originale") return null; // colori e texture del sorgente
    if (kind === "mimetica") return camoColor(livery.camo ?? "woodland", z + 0.37 * x, y + 0.61 * x);
    if (kind === "vernice") return livery.color ?? PRESETS.vernice.color;
    if (kind === "vetro" || kind === "faro" || kind === "fanale" || kind === "pneumatico" || kind === "cingolo") return PRESETS[kind].color;
    return null;
  };
}

/** Applica la livrea ai nodi del GLB già separato per componenti. */
export async function applyLiveryToDoc(doc: Document, livery: Livery): Promise<string[]> {
  if (livery.mode === "originale") return [];
  const notes: string[] = [];
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const camoMats = new Map<number, Material>();
  const paint = new Map<string, Material>();
  const getPreset = (kind: keyof typeof PRESETS, color?: [number, number, number]) => {
    const key = `${kind}:${color?.join(",") ?? ""}`;
    let m = paint.get(key);
    if (!m) {
      const p = PRESETS[kind];
      const c = color ?? p.color;
      m = doc.createMaterial(p.label).setBaseColorFactor([srgbToLinear(c[0] / 255), srgbToLinear(c[1] / 255), srgbToLinear(c[2] / 255), p.alpha])
        .setMetallicFactor(p.metallic).setRoughnessFactor(p.roughness).setAlphaMode(p.alpha < 1 ? "BLEND" : "OPAQUE");
      paint.set(key, m);
    }
    return m;
  };
  for (const node of doc.getRoot().listNodes()) {
    const part = (node.getExtras() as { vehicle3d_part?: string }).vehicle3d_part;
    const mesh = node.getMesh();
    if (!part || !mesh || part === "interior") continue;
    const kind = materialForPart(part, livery);
    if (kind === "mimetica") {
      const camoFor = async (texCoord: number) => {
        let m = camoMats.get(texCoord);
        if (!m) {
          let tex = camoMats.size ? [...camoMats.values()][0].getBaseColorTexture() : null;
          if (!tex) {
            const size = 512, meters = 4;
            const png = await sharp(Buffer.from(camoTexture(livery.camo ?? "woodland", size, meters)), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
            tex = doc.createTexture("mimetica").setImage(new Uint8Array(png)).setMimeType("image/png");
          }
          m = doc.createMaterial(`Mimetica ${livery.camo ?? "woodland"}`).setMetallicFactor(0.1).setRoughnessFactor(0.8).setBaseColorTexture(tex);
          m.getBaseColorTextureInfo()!.setTexCoord(texCoord);
          camoMats.set(texCoord, m);
        }
        return m;
      };
      for (const prim of mesh.listPrimitives()) {
        // UV planari dedicate (TEXCOORD_1): 1 ripetizione ogni 4 m
        const P = prim.getAttribute("POSITION")!;
        const M = node.getWorldMatrix();
        const uv = new Float32Array(P.getCount() * 2);
        const v = [0, 0, 0];
        for (let i = 0; i < P.getCount(); i++) {
          P.getElement(i, v);
          const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
          uv[i * 2] = (z + 0.37 * x) / 4;
          uv[i * 2 + 1] = (y + 0.61 * x) / 4;
        }
        // glTF richiede indici continui: senza TEXCOORD_0 le UV planari diventano TEXCOORD_0
        const slot = prim.getAttribute("TEXCOORD_0") ? 1 : 0;
        prim.setAttribute(`TEXCOORD_${slot}`, doc.createAccessor().setType("VEC2").setArray(uv).setBuffer(buffer));
        prim.setMaterial(await camoFor(slot));
      }
    } else if (kind === "vernice") {
      for (const prim of mesh.listPrimitives()) prim.setMaterial(getPreset("vernice", livery.color));
    } else {
      for (const prim of mesh.listPrimitives()) prim.setMaterial(getPreset(kind));
    }
  }
  notes.push(livery.mode === "mimetica" ? `Mimetica procedurale "${livery.camo ?? "woodland"}" applicata a carrozzeria/scafo.` : "Vernice uniforme applicata alla carrozzeria.");
  return notes;
}

/** Texture reale (es. tessuto Poly Haven) sul materiale dell'abitacolo procedurale. */
export function applyTextureToNode(doc: Document, node: Node, image: Uint8Array, mime: string, name: string) {
  const mesh = node.getMesh();
  if (!mesh) return;
  const tex = doc.createTexture(name).setImage(image).setMimeType(mime);
  for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial()?.clone() ?? doc.createMaterial(name);
    m.setBaseColorTexture(tex);
    prim.setMaterial(m);
  }
}
