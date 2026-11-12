import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { runPipeline } from "@/lib/pipeline";
import { readGlb } from "@/lib/mesh/io";
import { verifyMcaddon } from "@/lib/verify";
import { syntheticCar } from "./fixtures";

const vehicle = { make: "Test", model: "Auto", year: 2020, category: "auto" as const, seats: 5, dimensions_m: { length: 4.2, width: 1.7, height: 1.45 } };
const jobs: string[] = [];
afterAll(async () => {
  for (const j of jobs) await rm(path.join(process.cwd(), ".data", "jobs", j), { recursive: true, force: true });
});

describe("pipeline completa su veicolo sintetico", () => {
  it("genera GLB, OBJ e MCADDON verificati con 4 ruote e orientamento corretto", async () => {
    const glb = await syntheticCar({ rearAt: "+z", scale: 0.01 }); // retro sul lato sbagliato e scala in centimetri
    const r = await runPipeline(glb, { vehicle, quality: "ULTRA", source: "test" });
    jobs.push(r.jobId);
    const rep = r.report as {
      normalization: { dimensions: { length: number } };
      segmentation: { wheels: { name: string; radius_m: number }[]; autoFlipped: boolean; frontDetection: string };
      minecraft: { cubes: number; bones: string[] };
      interior: { seats: number };
      verification: Record<string, { ok: boolean }>;
    };
    expect(rep.normalization.dimensions.length).toBeCloseTo(4.2, 1);
    expect(rep.segmentation.frontDetection).toBe("lights");
    expect(rep.segmentation.autoFlipped).toBe(true);
    expect(rep.segmentation.wheels).toHaveLength(4);
    for (const w of rep.segmentation.wheels) expect(w.radius_m).toBeGreaterThan(0.2);
    expect(rep.minecraft.bones).toEqual(expect.arrayContaining(["body", "glass", "interior", "wheel_1_l", "wheel_2_r"]));
    expect(rep.interior.seats).toBe(5);
    expect(Object.values(rep.verification).every((v) => v.ok)).toBe(true);
    expect(r.files.map((f) => f.kind).sort()).toEqual(["geometry", "glb", "mcaddon", "obj", "report", "texture"]);
  });

  it("separa i componenti in nodi GLB con pivot delle ruote", async () => {
    const r = await runPipeline(await syntheticCar({ rearAt: "-z" }), { vehicle, quality: "STANDARD", source: "test" });
    jobs.push(r.jobId);
    const { readFile } = await import("node:fs/promises");
    const glbFile = r.files.find((f) => f.kind === "glb")!;
    const doc = await readGlb(await readFile(path.join(process.cwd(), ".data", "jobs", r.jobId, glbFile.name)));
    const names = doc.getRoot().listNodes().map((n) => n.getName());
    expect(names).toEqual(expect.arrayContaining(["Veicolo", "Carrozzeria", "Vetri", "Abitacolo", "Ruota_asse1_sinistra", "Ruota_asse2_destra"]));
    const wheel = doc.getRoot().listNodes().find((n) => n.getName() === "Ruota_asse1_sinistra")!;
    expect(wheel.getTranslation()[1]).toBeGreaterThan(0.2); // pivot all'altezza del mozzo
    expect((r.report as { segmentation: { autoFlipped: boolean } }).segmentation.autoFlipped).toBe(false);
  });

  it("rifiuta file che non sono modelli", async () => {
    await expect(runPipeline(new TextEncoder().encode("non un glb"), { vehicle, quality: "ULTRA", source: "test" })).rejects.toThrow(/GLB valido/);
  });
});

describe("verifica mcaddon", () => {
  it("segnala un pacchetto incoerente", async () => {
    const zip = new JSZip();
    zip.file("x_RP/manifest.json", JSON.stringify({ format_version: 2, header: { uuid: "bad", min_engine_version: [1, 20, 0] }, modules: [{ type: "resources", uuid: "bad" }] }));
    zip.file("x_BP/manifest.json", "{ rotto");
    const v = await verifyMcaddon(await zip.generateAsync({ type: "nodebuffer" }));
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name === "JSON validi")?.ok).toBe(false);
  });
});
