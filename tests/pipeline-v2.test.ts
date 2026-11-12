import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { importModel } from "@/lib/formats/import";
import { parseLicense, type Credit } from "@/lib/licenses";
import { CAMO_PALETTES } from "@/lib/materials/camo";
import { readGlb } from "@/lib/mesh/io";
import { runPipeline, type PartReport } from "@/lib/pipeline";
import { syntheticCar, syntheticTank } from "./fixtures";

const jobs: string[] = [];
afterAll(async () => { for (const j of jobs) await rm(path.join(process.cwd(), ".data", "jobs", j), { recursive: true, force: true }); });
const file = (jobId: string, name: string) => readFile(path.join(process.cwd(), ".data", "jobs", jobId, name));
const car = { make: "Test", model: "Auto", category: "auto" as const, seats: 5, dimensions_m: { length: 4.2, width: 1.7, height: 1.45 } };
const tank = { make: "Test", model: "Carro", category: "carro_armato" as const, seats: 3, dimensions_m: { length: 9.7, width: 3.7, height: 2.2 } };
const credit = (lic: string, usage: Credit["usage"] = "modello"): Credit => ({ title: "Modello di prova", author: "Autore Test", sourceName: "Test", sourceUrl: "https://example.org/m", license: parseLicense(lic), usage });

describe("pipeline: licenze e crediti", () => {
  it("blocca l'esportazione se la licenza vieta i derivati (ND) e non salva file", async () => {
    await expect(runPipeline(await syntheticCar({ rearAt: "-z" }), { vehicle: car, quality: "STANDARD", source: "test", credits: [credit("CC BY-ND 4.0")] }))
      .rejects.toMatchObject({ code: "LICENSE_BLOCKED" });
  });
  it("blocca l'uso commerciale di un modello NC", async () => {
    await expect(runPipeline(await syntheticCar({ rearAt: "-z" }), { vehicle: car, quality: "STANDARD", source: "test", credits: [credit("CC BY-NC 4.0")], commercial: true }))
      .rejects.toMatchObject({ code: "LICENSE_BLOCKED" });
  });
  it("include i crediti in MCADDON, OBJ e GLB", async () => {
    const r = await runPipeline(await syntheticCar({ rearAt: "-z" }), { vehicle: car, quality: "STANDARD", source: "test", credits: [credit("CC BY 4.0")] });
    jobs.push(r.jobId);
    const mc = await JSZip.loadAsync(await file(r.jobId, r.files.find((f) => f.kind === "mcaddon")!.name));
    const cr = Object.keys(mc.files).filter((f) => f.endsWith("CREDITS.txt"));
    expect(cr).toHaveLength(2);
    expect(await mc.file(cr[0])!.async("string")).toMatch(/Autore Test[\s\S]*CC BY 4\.0/);
    const manifest = JSON.parse(await mc.file(Object.keys(mc.files).find((f) => f.endsWith("_RP/manifest.json"))!)!.async("string"));
    expect(manifest.metadata.authors).toContain("Autore Test");
    const obj = await JSZip.loadAsync(await file(r.jobId, r.files.find((f) => f.kind === "obj")!.name));
    expect(obj.file("CREDITS.txt")).toBeTruthy();
    const doc = await readGlb(await file(r.jobId, r.files.find((f) => f.kind === "glb")!.name));
    expect(doc.getRoot().getAsset().copyright).toMatch(/Autore Test/);
  });
});

describe("pipeline: carro armato", () => {
  it("torretta e cannone in gerarchia, nessun sedile inventato, parti dichiarate", async () => {
    const r = await runPipeline(await syntheticTank({ barrelAt: "-z", anonymous: true }), { vehicle: tank, quality: "STANDARD", source: "test" });
    jobs.push(r.jobId);
    const rep = r.report as { parts: PartReport[]; segmentation: { autoFlipped: boolean }; interior: { seats: number; boxes: number } };
    expect(rep.segmentation.autoFlipped).toBe(true);
    expect(rep.interior.boxes).toBe(0);
    expect(rep.interior.seats).toBe(3);
    const st = Object.fromEntries(rep.parts.map((p) => [p.part, p.status]));
    expect(st["Torretta"]).toBe("separata con euristica");
    expect(st["Cannone"]).toBe("separata con euristica");
    expect(st["Sedili"]).toBe("non presente");
    expect(st["Motore"]).toBe("non presente");
    const geo = JSON.parse((await file(r.jobId, r.files.find((f) => f.kind === "geometry")!.name)).toString())["minecraft:geometry"][0];
    const barrel = geo.bones.find((b: { name: string }) => b.name === "barrel");
    const turret = geo.bones.find((b: { name: string }) => b.name === "turret");
    expect(barrel.parent).toBe("turret");
    expect(barrel.pivot).toEqual(turret.pivot);
    // dopo la rotazione il cannone punta verso l'anteriore Bedrock (−Z)
    const minZ = Math.min(...barrel.cubes.map((c: { origin: number[] }) => c.origin[2]));
    expect(minZ).toBeLessThan(-60);
  });
});

describe("pipeline: livrea", () => {
  it("mimetica desertica sui voxel della carrozzeria e materiale con UV dedicate nel GLB", async () => {
    const r = await runPipeline(await syntheticTank({ barrelAt: "+z" }), { vehicle: tank, quality: "STANDARD", source: "test", livery: { mode: "mimetica", camo: "deserto" } });
    jobs.push(r.jobId);
    const png = await file(r.jobId, r.files.find((f) => f.kind === "texture")!.name);
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const pal = CAMO_PALETTES.deserto.map((c) => c.join(","));
    const found = new Set<string>();
    for (let i = 0; i < info.width * info.height; i++) { const k = [data[i * info.channels], data[i * info.channels + 1], data[i * info.channels + 2]].join(","); if (pal.includes(k)) found.add(k); }
    expect(found.size).toBeGreaterThanOrEqual(2);
    const doc = await readGlb(await file(r.jobId, r.files.find((f) => f.kind === "glb")!.name));
    expect(doc.getRoot().listMaterials().some((m) => m.getName().startsWith("Mimetica"))).toBe(true);
    expect(doc.getRoot().listMaterials().filter((m) => m.getName().startsWith("Mimetica")).every((m) => m.getBaseColorTexture())).toBe(true);
  });
});

describe("pipeline: motore D (riuso geometria Bedrock)", () => {
  it("riusa bone e cubi dell'addon originale e mantiene i crediti", async () => {
    const first = await runPipeline(await syntheticCar({ rearAt: "-z" }), { vehicle: car, quality: "STANDARD", source: "test" });
    jobs.push(first.jobId);
    const mc = await file(first.jobId, first.files.find((f) => f.kind === "mcaddon")!.name);
    const imp = await importModel(new Uint8Array(mc), "originale.mcaddon");
    const r = await runPipeline(imp.glb, {
      vehicle: car, quality: "STANDARD", source: "addon esistente", bedrock: { geometry: imp.bedrock!.geometry as never, texture: imp.bedrock!.texture! },
      credits: [credit("MIT", "addon")],
    });
    jobs.push(r.jobId);
    const orig = imp.bedrock!.geometry as { bones: { name: string; cubes?: unknown[] }[] };
    const geo = JSON.parse((await file(r.jobId, r.files.find((f) => f.kind === "geometry")!.name)).toString())["minecraft:geometry"][0];
    expect(geo.bones.map((b: { name: string }) => b.name)).toEqual(orig.bones.map((b) => b.name));
    expect(geo.bones.reduce((s: number, b: { cubes?: unknown[] }) => s + (b.cubes?.length ?? 0), 0)).toBe(orig.bones.reduce((s, b) => s + (b.cubes?.length ?? 0), 0));
    expect((r.report as { minecraft: { reusedGeometry: boolean } }).minecraft.reusedGeometry).toBe(true);
    expect(r.files.some((f) => f.kind === "credits")).toBe(true);
  });
});
