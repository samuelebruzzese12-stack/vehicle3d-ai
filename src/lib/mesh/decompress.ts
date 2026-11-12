import "server-only";
import { readGlb, writeGlb } from "./io";

/** Riscrive un GLB senza compressione Draco/meshopt (per strumenti che non la supportano, es. bpy). */
export async function decompressGlb(buf: Uint8Array): Promise<Uint8Array> {
  const doc = await readGlb(buf);
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === "KHR_draco_mesh_compression" || ext.extensionName === "EXT_meshopt_compression") ext.dispose();
  }
  return writeGlb(doc);
}
