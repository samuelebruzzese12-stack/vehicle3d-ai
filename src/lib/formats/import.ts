import "server-only";
import JSZip from "jszip";
import { AppError } from "../errors";
import { getIO, writeGlb } from "../mesh/io";
import { env } from "../env";
import { objToDocument } from "./obj";
import { stlToDocument } from "./stl";

export type InputFormat = "glb" | "gltf" | "obj" | "stl" | "fbx" | "blend" | "bedrock" | "mcaddon";

export interface ImportedModel {
  glb: Uint8Array;
  format: InputFormat;
  /** file dell'archivio usato */
  entry?: string;
  /** geometria Bedrock originale (motore D) */
  bedrock?: { geometry: unknown; texture?: Uint8Array; files: string[] };
  notes: string[];
}

const isGlb = (b: Uint8Array) => b.length > 12 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

async function viaBlender(data: Uint8Array, ext: "fbx" | "blend"): Promise<Uint8Array> {
  const url = env.blenderWorkerUrl();
  if (!url) throw new AppError("NOT_CONFIGURED", `Il formato ${ext.toUpperCase()} richiede il worker Blender (BLENDER_WORKER_URL): non ci sono convertitori ${ext.toUpperCase()} affidabili in JavaScript.`);
  const res = await fetch(`${url.replace(/\/$/, "")}/convert?format=${ext}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.blenderWorkerToken() ?? ""}` },
    body: Buffer.from(data),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new AppError("PROVIDER_ERROR", `Conversione ${ext.toUpperCase()} fallita nel worker Blender: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Converte qualsiasi formato supportato in GLB. `name` è il nome file (per l'estensione). */
export async function importModel(data: Uint8Array, name = "model"): Promise<ImportedModel> {
  const lower = name.toLowerCase();
  if (isGlb(data)) return { glb: data, format: "glb", notes: [] };
  if (lower.endsWith(".obj")) return { glb: await writeGlb(objToDocument(new TextDecoder().decode(data))), format: "obj", notes: ["OBJ senza MTL: colori predefiniti."] };
  if (lower.endsWith(".stl")) return { glb: await writeGlb(stlToDocument(data)), format: "stl", notes: ["STL: geometria senza colori né texture."] };
  if (lower.endsWith(".fbx")) return { glb: await viaBlender(data, "fbx"), format: "fbx", notes: ["Convertito da FBX con Blender."] };
  if (lower.endsWith(".blend")) return { glb: await viaBlender(data, "blend"), format: "blend", notes: ["Convertito da BLEND con Blender."] };
  if (!isZip(data)) throw new AppError("INVALID_MODEL", "Formato non riconosciuto. Supportati: GLB, glTF (zip), OBJ, STL, FBX, BLEND, MCADDON/MCPACK.");

  const zip = await JSZip.loadAsync(data);
  const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir && !f.startsWith("__MACOSX/"));
  const read = (f: string) => zip.file(f)!.async("uint8array");
  const pick = (re: RegExp) => files.filter((f) => re.test(f)).sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0];

  const glb = pick(/\.glb$/i);
  if (glb) return { glb: await read(glb), format: "glb", entry: glb, notes: [] };

  const gltf = pick(/\.gltf$/i);
  if (gltf) {
    const json = JSON.parse(new TextDecoder().decode(await read(gltf)));
    const dir = gltf.includes("/") ? gltf.slice(0, gltf.lastIndexOf("/") + 1) : "";
    const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
    const uris = [...(json.buffers ?? []), ...(json.images ?? [])].map((x: { uri?: string }) => x.uri).filter((u: string | undefined): u is string => Boolean(u) && !u!.startsWith("data:"));
    for (const uri of uris) {
      const path = dir + decodeURIComponent(uri);
      const f = zip.file(path) ?? zip.file(dir + uri);
      if (!f) throw new AppError("INVALID_MODEL", `Archivio glTF incompleto: manca ${uri}.`);
      resources[uri] = new Uint8Array(await f.async("uint8array"));
    }
    const io = await getIO();
    const doc = await io.readJSON({ json, resources });
    return { glb: await writeGlb(doc), format: "gltf", entry: gltf, notes: [] };
  }

  const obj = pick(/\.obj$/i);
  if (obj) {
    const map = new Map<string, Uint8Array>();
    for (const f of files.filter((x) => /\.(mtl|png|jpe?g)$/i.test(x))) map.set(f, await read(f));
    return { glb: await writeGlb(objToDocument(new TextDecoder().decode(await read(obj)), map)), format: "obj", entry: obj, notes: [] };
  }

  const geo = files.filter((f) => /\.geo\.json$|models\/entity\/.+\.json$/i.test(f));
  if (geo.length) {
    const { bedrockToDocument } = await import("../minecraft/bedrock-import");
    const r = await bedrockToDocument(zip, files, geo);
    return { glb: await writeGlb(r.doc), format: name.endsWith(".mcaddon") || name.endsWith(".mcpack") ? "mcaddon" : "bedrock", entry: r.geometryFile, bedrock: { geometry: r.geometry, texture: r.texture, files: r.used }, notes: r.notes };
  }

  const stl = pick(/\.stl$/i);
  if (stl) return { glb: await writeGlb(stlToDocument(await read(stl))), format: "stl", entry: stl, notes: ["STL: geometria senza colori né texture."] };

  for (const ext of ["fbx", "blend"] as const) {
    const f = pick(new RegExp(`\\.${ext}$`, "i"));
    if (f) {
      const r = await viaBlender(await read(f), ext);
      return { glb: r, format: ext, entry: f, notes: [`Convertito da ${ext.toUpperCase()} con Blender.`] };
    }
  }
  throw new AppError("INVALID_MODEL", "L'archivio non contiene modelli supportati (GLB, glTF, OBJ, FBX, BLEND, geometrie Bedrock).");
}
