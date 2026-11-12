import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { downloadCandidate, searchExternalModels } from "@/lib/engines/acquire";
import { readGlb } from "@/lib/mesh/io";
import { triangleCount } from "@/lib/mesh/scene";
import { runPipeline } from "@/lib/pipeline";

describe("Test 4: recupero di un modello 3D esistente (motore C, licenza verificata)", () => {
  it("T-90 e Alfa Romeo 159: nessun modello non pertinente viene accettato", async () => {
    for (const name of ["T-90", "Alfa Romeo 159"]) {
      const r = await searchExternalModels(name, false);
      console.log(name, JSON.stringify(r.summary), "utilizzabili e pertinenti:", r.candidates.filter((c) => c.usable && c.relevance >= 0.6).map((c) => c.name));
      for (const c of r.candidates.filter((c) => c.usable && c.relevance >= 0.6)) expect(c.name.toLowerCase()).toContain(name.toLowerCase().split(" ").pop()!);
    }
  });

  it("Leopard (Wikimedia Commons, CC BY-SA): ricerca → download → conversione → MCADDON con crediti", async () => {
    const r = await searchExternalModels("Leopard tank", false);
    const c = r.candidates.find((x) => x.usable && /leopard/i.test(x.name));
    console.log("scelto:", c?.name, c?.author, c?.license.label, c?.pageUrl);
    expect(c).toBeTruthy();
    const m = await downloadCandidate(c!, false);
    expect(m.format).toBe("stl");
    const tris = triangleCount(await readGlb(m.glb));
    console.log("triangoli STL:", tris);
    expect(tris).toBeGreaterThan(1000);
    const out = await runPipeline(m.glb, {
      vehicle: { make: "Krauss-Maffei", model: "Leopard", category: "carro_armato", seats: 4 }, quality: "STANDARD", source: "Wikimedia Commons", credits: [m.credit],
    });
    const rep = out.report as { licenses: { inheritedLicense?: { id: string } }; parts: unknown[]; minecraft: { cubes: number; bones: string[] }; normalization: { dimensions: unknown } };
    console.log("dimensioni:", JSON.stringify(rep.normalization.dimensions), "cubi:", rep.minecraft.cubes, "bone:", rep.minecraft.bones.join(","));
    expect(rep.licenses.inheritedLicense?.id).toBe("cc-by-sa");
    const mc = await JSZip.loadAsync(await readFile(path.join(process.cwd(), ".data", "jobs", out.jobId, out.files.find((f) => f.kind === "mcaddon")!.name)));
    const credits = await mc.file(Object.keys(mc.files).find((f) => f.endsWith("CREDITS.txt"))!)!.async("string");
    expect(credits).toMatch(/Leopard/);
    expect(credits).toMatch(/CC BY-SA/);
    expect(credits).toMatch(/share-alike/);
  });
});
