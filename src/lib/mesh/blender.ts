import "server-only";
import { env } from "../env";
import { decompressGlb } from "./decompress";

export interface BlenderResult { glb: Uint8Array; report: Record<string, unknown> }

/** Pre-elaborazione opzionale tramite worker Blender. Ritorna null se non configurato. Lancia in caso di errore. */
export async function blenderPreprocess(glb: Uint8Array, targetTris: number): Promise<BlenderResult | null> {
  const url = env.blenderWorkerUrl();
  if (!url) return null;
  const body = await decompressGlb(glb); // il bpy di pip non decodifica Draco
  const res = await fetch(`${url.replace(/\/$/, "")}/process?target_tris=${targetTris}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.blenderWorkerToken() ?? ""}`, "Content-Type": "model/gltf-binary" },
    body: Buffer.from(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`worker Blender ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const report = JSON.parse(res.headers.get("x-vehicle3d-report") ?? "{}");
  return { glb: new Uint8Array(await res.arrayBuffer()), report };
}
