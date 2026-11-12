import "server-only";
import { Document, type Node, TextureInfo } from "@gltf-transform/core";
import type JSZip from "jszip";
import sharp from "sharp";

type V3 = [number, number, number];
interface FaceUv { uv: [number, number]; uv_size?: [number, number] }
interface Cube { origin: V3; size: V3; uv?: [number, number] | Record<string, FaceUv>; inflate?: number; pivot?: V3; rotation?: V3; mirror?: boolean }
interface Bone { name: string; parent?: string; pivot?: V3; rotation?: V3; mirror?: boolean; cubes?: Cube[] }
export interface BedrockGeometry { identifier: string; textureWidth: number; textureHeight: number; bones: Bone[] }

/** Normalizza formato moderno (1.12+) e legacy (1.8/1.10). */
export function parseGeometryFile(json: Record<string, unknown>): BedrockGeometry[] {
  const out: BedrockGeometry[] = [];
  const modern = json["minecraft:geometry"] as { description: { identifier: string; texture_width?: number; texture_height?: number }; bones?: Bone[] }[] | undefined;
  if (Array.isArray(modern)) {
    for (const g of modern) out.push({ identifier: g.description.identifier, textureWidth: g.description.texture_width ?? 64, textureHeight: g.description.texture_height ?? 64, bones: g.bones ?? [] });
  }
  for (const [k, v] of Object.entries(json)) {
    if (!k.startsWith("geometry.")) continue;
    const g = v as { texturewidth?: number; textureheight?: number; bones?: Bone[] };
    out.push({ identifier: k.split(":")[0], textureWidth: g.texturewidth ?? 64, textureHeight: g.textureheight ?? 64, bones: g.bones ?? [] });
  }
  return out;
}

const DEG = Math.PI / 180;
/** Quaternione da angoli Bedrock (gradi). Bedrock applica Z, poi Y, poi X, con X e Y invertiti rispetto alla convenzione destrorsa. */
function quat(r: V3): [number, number, number, number] {
  const [x, y, z] = [-r[0] * DEG, -r[1] * DEG, r[2] * DEG];
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2), cy = Math.cos(y / 2), sy = Math.sin(y / 2), cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  // q = qx * qy * qz  (applica z, poi y, poi x)
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}
function rotate(q: [number, number, number, number], v: V3): V3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

type FaceName = "north" | "south" | "east" | "west" | "up" | "down";
function boxUv(u: number, v: number, s: V3): Record<FaceName, [number, number, number, number]> {
  const [w, h, d] = s.map((x) => Math.floor(x)) as V3;
  return {
    east: [u, v + d, d, h], north: [u + d, v + d, w, h], west: [u + d + w, v + d, d, h], south: [u + 2 * d + w, v + d, w, h],
    up: [u + d, v, w, d], down: [u + d + w, v + d, w, -d],
  };
}

/** Geometria → documento glTF (unità: metri, anteriore +Z, sinistra +X, come il resto della pipeline). */
export async function bedrockToDocument(zip: JSZip, files: string[], geoFiles: string[]) {
  const notes: string[] = [];
  let geometry: BedrockGeometry | null = null, geometryFile = "";
  for (const f of geoFiles) {
    try {
      const gs = parseGeometryFile(JSON.parse(await zip.file(f)!.async("string")));
      // preferisce la geometria con più cubi (il veicolo, non un'icona)
      for (const g of gs) {
        const n = g.bones.reduce((s, b) => s + (b.cubes?.length ?? 0), 0);
        const cur = geometry ? geometry.bones.reduce((s, b) => s + (b.cubes?.length ?? 0), 0) : -1;
        if (n > cur) { geometry = g; geometryFile = f; }
      }
    } catch { notes.push(`JSON non valido: ${f}`); }
  }
  if (!geometry) throw new Error("Nessuna geometria Bedrock valida nell'archivio.");

  // texture: quella indicata dalla client entity che usa la geometria, altrimenti la png più plausibile
  let texPath: string | undefined;
  for (const f of files.filter((x) => /entity\/.+\.json$/i.test(x) && !/models\//i.test(x))) {
    try {
      const ce = JSON.parse(await zip.file(f)!.async("string"))["minecraft:client_entity"]?.description;
      if (ce && Object.values(ce.geometry ?? {}).includes(geometry.identifier)) {
        const t = Object.values(ce.textures ?? {})[0] as string | undefined;
        if (t) texPath = files.find((x) => x.toLowerCase().endsWith(`${t.toLowerCase()}.png`));
      }
    } catch { /* ignora */ }
  }
  const base = geometry.identifier.replace(/^geometry\./, "").split(".").pop()!;
  texPath ??= files.find((x) => /textures\/.+\.png$/i.test(x) && x.toLowerCase().includes(base.toLowerCase())) ?? files.find((x) => /textures\/entity\/.+\.png$/i.test(x));
  const texture = texPath ? await zip.file(texPath)!.async("uint8array") : undefined;
  if (!texture) notes.push("Texture non trovata: colori predefiniti.");

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("Scene");
  const mat = doc.createMaterial("Bedrock").setRoughnessFactor(0.9).setMetallicFactor(0).setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true);
  if (texture) {
    const meta = await sharp(texture).metadata();
    if (meta.width && meta.width !== geometry.textureWidth) notes.push(`Texture ${meta.width}px, geometria dichiara ${geometry.textureWidth}px.`);
    const tex = doc.createTexture("bedrock").setImage(texture).setMimeType("image/png");
    mat.setBaseColorTexture(tex);
    mat.getBaseColorTextureInfo()!.setMagFilter(TextureInfo.MagFilter.NEAREST).setMinFilter(TextureInfo.MinFilter.NEAREST);
  } else mat.setBaseColorFactor([0.6, 0.6, 0.6, 1]);

  // radice: px → m e rotazione di 180° (Bedrock anteriore −Z → canonico +Z)
  const root = doc.createNode("Veicolo").setScale([1 / 16, 1 / 16, 1 / 16]).setRotation([0, 1, 0, 0]);
  scene.addChild(root);
  const nodes = new Map<string, Node>();
  const pivots = new Map<string, V3>();
  const TW = geometry.textureWidth, TH = geometry.textureHeight;
  let cubesCount = 0;

  for (const b of geometry.bones) {
    const pivot = (b.pivot ?? [0, 0, 0]) as V3;
    pivots.set(b.name, pivot);
    const node = doc.createNode(b.name).setExtras({ vehicle3d_part: b.name, bedrock_bone: true });
    if (b.rotation) node.setRotation(quat(b.rotation));
    nodes.set(b.name, node);
    const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
    for (const c of b.cubes ?? []) {
      cubesCount++;
      const inf = c.inflate ?? 0;
      const [x0, y0, z0] = [c.origin[0] - inf, c.origin[1] - inf, c.origin[2] - inf];
      const [x1, y1, z1] = [c.origin[0] + c.size[0] + inf, c.origin[1] + c.size[1] + inf, c.origin[2] + c.size[2] + inf];
      const mirror = c.mirror ?? b.mirror ?? false;
      let faces: Partial<Record<FaceName, [number, number, number, number]>> = {};
      if (Array.isArray(c.uv)) faces = boxUv(c.uv[0], c.uv[1], c.size);
      else if (c.uv) for (const [k, f] of Object.entries(c.uv)) faces[k as FaceName] = [f.uv[0], f.uv[1], f.uv_size?.[0] ?? 1, f.uv_size?.[1] ?? 1];
      if (mirror && Array.isArray(c.uv)) [faces.east, faces.west] = [faces.west, faces.east];
      const q = c.rotation ? quat(c.rotation) : null;
      const cp = (c.pivot ?? [0, 0, 0]) as V3;
      const corner = (x: number, y: number, z: number): V3 => {
        let p: V3 = [x, y, z];
        if (q) { const r = rotate(q, [p[0] - cp[0], p[1] - cp[1], p[2] - cp[2]]); p = [r[0] + cp[0], r[1] + cp[1], r[2] + cp[2]]; }
        return [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
      };
      const quads: [FaceName, V3, V3[]][] = [
        ["north", [0, 0, -1], [corner(x1, y1, z0), corner(x0, y1, z0), corner(x0, y0, z0), corner(x1, y0, z0)]],
        ["south", [0, 0, 1], [corner(x0, y1, z1), corner(x1, y1, z1), corner(x1, y0, z1), corner(x0, y0, z1)]],
        ["east", [1, 0, 0], [corner(x1, y1, z1), corner(x1, y1, z0), corner(x1, y0, z0), corner(x1, y0, z1)]],
        ["west", [-1, 0, 0], [corner(x0, y1, z0), corner(x0, y1, z1), corner(x0, y0, z1), corner(x0, y0, z0)]],
        ["up", [0, 1, 0], [corner(x0, y1, z0), corner(x1, y1, z0), corner(x1, y1, z1), corner(x0, y1, z1)]],
        ["down", [0, -1, 0], [corner(x0, y0, z1), corner(x1, y0, z1), corner(x1, y0, z0), corner(x0, y0, z0)]],
      ];
      for (const [fname, n, vs] of quads) {
        const r = faces[fname];
        if (!r) continue;
        let [u, v, w, h] = r;
        if (mirror && Array.isArray(c.uv)) { u += w; w = -w; }
        const uvq = [[u, v], [u + w, v], [u + w, v + h], [u, v + h]];
        const base0 = pos.length / 3;
        const nn = q ? rotate(q, n) : n;
        vs.forEach((p, i) => { pos.push(...p); nor.push(...nn); uv.push(uvq[i][0] / TW, uvq[i][1] / TH); });
        idx.push(base0, base0 + 3, base0 + 2, base0, base0 + 2, base0 + 1);
      }
    }
    if (pos.length) {
      const prim = doc.createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(nor)).setBuffer(buffer))
        .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buffer))
        .setMaterial(mat);
      node.setMesh(doc.createMesh(b.name).addPrimitive(prim));
    }
  }
  // gerarchia e traslazioni relative ai pivot
  for (const b of geometry.bones) {
    const node = nodes.get(b.name)!;
    const pv = pivots.get(b.name)!;
    const parent = b.parent ? nodes.get(b.parent) : undefined;
    const pp = b.parent ? pivots.get(b.parent) ?? [0, 0, 0] : [0, 0, 0];
    node.setTranslation([pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]]);
    (parent ?? root).addChild(node);
  }
  if (!cubesCount) throw new Error("La geometria Bedrock non contiene cubi.");
  notes.push(`${cubesCount} cubi in ${geometry.bones.length} bone convertiti da ${geometryFile}.`);
  return { doc, geometry, texture, geometryFile, used: [geometryFile, ...(texPath ? [texPath] : [])], notes };
}
