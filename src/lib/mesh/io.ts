import "server-only";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

let ioPromise: Promise<NodeIO> | null = null;

export function getIO(): Promise<NodeIO> {
  if (!ioPromise) {
    ioPromise = (async () => {
      await MeshoptDecoder.ready;
      await MeshoptEncoder.ready;
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
          "draco3d.decoder": await draco3d.createDecoderModule(),
          "meshopt.decoder": MeshoptDecoder,
          "meshopt.encoder": MeshoptEncoder,
        });
    })();
  }
  return ioPromise;
}

export async function readGlb(buf: Uint8Array): Promise<Document> {
  const io = await getIO();
  return io.readBinary(buf);
}

export async function writeGlb(doc: Document): Promise<Uint8Array> {
  const io = await getIO();
  return io.writeBinary(doc);
}
