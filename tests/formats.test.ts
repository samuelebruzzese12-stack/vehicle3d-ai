import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { importModel } from "@/lib/formats/import";
import { readGlb } from "@/lib/mesh/io";
import { computeBounds, triangleCount } from "@/lib/mesh/scene";
import { runPipeline } from "@/lib/pipeline";
import { syntheticCar } from "./fixtures";

const vehicle = { make: "Test", model: "Formati", category: "auto" as const, seats: 4, dimensions_m: { length: 4.2, width: 1.7, height: 1.45 } };
const jobs: string[] = [];
afterAll(async () => { for (const j of jobs) await rm(path.join(process.cwd(), ".data", "jobs", j), { recursive: true, force: true }); });

async function outputs() {
  const r = await runPipeline(await syntheticCar({ rearAt: "-z" }), { vehicle, quality: "STANDARD", source: "test" });
  jobs.push(r.jobId);
  const file = (k: string) => readFile(path.join(process.cwd(), ".data", "jobs", r.jobId, r.files.find((f) => f.kind === k)!.name));
  return { r, mcaddon: await file("mcaddon"), objZip: await file("obj") };
}

describe("importazione formati", () => {
  it("MCADDON → glTF: bone, cubi e dimensioni coerenti (giro completo)", async () => {
    const { r, mcaddon } = await outputs();
    const imp = await importModel(new Uint8Array(mcaddon), "x.mcaddon");
    expect(imp.format).toBe("mcaddon");
    const doc = await readGlb(imp.glb);
    const cubes = (r.report as { minecraft: { cubes: number } }).minecraft.cubes;
    expect(triangleCount(doc)).toBe(cubes * 12);
    const names = doc.getRoot().listNodes().map((n) => n.getName());
    expect(names).toEqual(expect.arrayContaining(["body", "glass", "wheel_1_l", "interior"]));
    // le dimensioni dopo il giro completo restano quelle del veicolo (±1 voxel)
    const { normalize } = await import("@/lib/mesh/scene");
    const norm = await normalize(doc, {});
    expect(norm.dimensions.length).toBeGreaterThan(4.1);
    expect(norm.dimensions.length).toBeLessThan(4.4);
    expect(doc.getRoot().listTextures().length).toBe(1);
  });

  it("OBJ (zip con MTL e texture) → glTF", async () => {
    const { objZip } = await outputs();
    const imp = await importModel(new Uint8Array(objZip), "x.zip");
    expect(imp.format).toBe("obj");
    const doc = await readGlb(imp.glb);
    expect(triangleCount(doc)).toBeGreaterThan(100);
    expect(doc.getRoot().listMaterials().length).toBeGreaterThan(1);
  });

  it("glTF in zip (gltf + bin separati) → glTF", async () => {
    const io = new NodeIO();
    const src = await io.readBinary(await syntheticCar({ rearAt: "-z" }));
    const { json, resources } = await io.writeJSON(src, { basename: "auto" });
    const zip = new JSZip();
    zip.file("modello/scene.gltf", JSON.stringify(json));
    for (const [k, v] of Object.entries(resources)) zip.file(`modello/${k}`, v);
    const imp = await importModel(await zip.generateAsync({ type: "uint8array" }), "m.zip");
    expect(imp.format).toBe("gltf");
    const doc = await readGlb(imp.glb);
    expect(triangleCount(doc)).toBe(triangleCount(src));
    expect(computeBounds(doc).max[2]).toBeCloseTo(2.12, 3); // scocca 2,10 m + fari sporgenti 2 cm
  });

  it("rifiuta formati sconosciuti e chiede Blender per FBX", async () => {
    await expect(importModel(new TextEncoder().encode("ciao"), "a.txt")).rejects.toThrow(/Formato non riconosciuto/);
    await expect(importModel(new Uint8Array([1, 2, 3]), "a.fbx")).rejects.toThrow(/worker Blender/);
  });
});
