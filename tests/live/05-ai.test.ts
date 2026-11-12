import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { generateAi, availableAiModels } from "@/lib/engines/ai";
import { runPipeline } from "@/lib/pipeline";
import { verifyGlb } from "@/lib/verify";

const photo = process.env.TEST_PHOTO;

describe.skipIf(!photo)("Test 5: generazione AI senza provider a pagamento", () => {
  it("modelli disponibili: solo licenze utilizzabili (Hunyuan3D escluso in UE)", () => {
    const ids = availableAiModels().map((m) => m.id);
    console.log("modelli abilitati:", ids.join(", "));
    expect(ids).not.toContain("hunyuan3d2");
    expect(ids).toContain("trellis");
  });

  it("genera un GLB da una foto e lo converte in MCADDON", async () => {
    const statuses: string[] = [];
    let r;
    try {
      r = await generateAi([await readFile(photo!)], { onStatus: (s) => statuses.push(s) });
    } catch (e) {
      console.log("ESITO generazione:", (e as Error).message);
      console.log("tentativi:", JSON.stringify((e as { details?: unknown }).details, null, 1));
      throw e;
    }
    console.log("generato con", r.model.name, "via", r.backend, "–", r.glb.byteLength, "byte; tentativi:", JSON.stringify(r.attempts));
    expect((await verifyGlb(r.glb)).ok).toBe(true);
    const out = await runPipeline(r.glb, { vehicle: { make: "Fiat", model: "Panda", year: 2012, category: "auto", dimensions_m: { length: 3.65, width: 1.64, height: 1.55 } }, quality: "STANDARD", source: r.backend });
    expect(out.files.some((f) => f.kind === "mcaddon")).toBe(true);
  });
});
