import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { runPipeline } from "@/lib/pipeline";
import { verifyMcaddon } from "@/lib/verify";
import { syntheticCar, syntheticTank } from "./fixtures";

const jobs: string[] = [];
afterAll(async () => { for (const j of jobs) await rm(path.join(process.cwd(), ".data", "jobs", j), { recursive: true, force: true }); });

async function build(kind: "car" | "tank") {
  const glb = kind === "car" ? await syntheticCar({ rearAt: "-z" }) : await syntheticTank({ barrelAt: "+z", anonymous: true });
  const vehicle = kind === "car"
    ? { make: "Test", model: "Bedrock", category: "auto" as const, seats: 4, dimensions_m: { length: 4.2, width: 1.7, height: 1.45 } }
    : { make: "Test", model: "Cingolato", category: "carro_armato" as const, seats: 3, dimensions_m: { length: 9.7, width: 3.7, height: 2.2 } };
  const r = await runPipeline(glb, { vehicle, quality: "ULTRA", source: "test" });
  jobs.push(r.jobId);
  const buf = await readFile(path.join(process.cwd(), ".data", "jobs", r.jobId, r.files.find((f) => f.kind === "mcaddon")!.name));
  return { r, buf, zip: await JSZip.loadAsync(buf) };
}
const json = async (zip: JSZip, re: RegExp) => JSON.parse(await zip.file(Object.keys(zip.files).find((f) => re.test(f))!)!.async("string"));

describe("Test 7: conversione Bedrock", () => {
  for (const kind of ["car", "tank"] as const) {
    it(`${kind}: geometria valida (bone, genitori, pivot, UV, budget Android)`, async () => {
      const { zip } = await build(kind);
      const geoFile = await json(zip, /models\/entity\/.+\.geo\.json$/);
      expect(geoFile.format_version).toBe("1.16.0");
      const g = geoFile["minecraft:geometry"][0];
      expect(g.description.identifier).toMatch(/^geometry\.vehicle3d\.[a-z0-9_]+$/);
      const names = new Set(g.bones.map((b: { name: string }) => b.name));
      expect(names.size).toBe(g.bones.length); // nomi unici
      let cubes = 0;
      for (const b of g.bones) {
        if (b.parent) expect(names.has(b.parent)).toBe(true);
        expect(b.pivot).toHaveLength(3);
        for (const c of b.cubes ?? []) {
          cubes++;
          expect(c.size.every((s: number) => s > 0)).toBe(true);
          for (const f of Object.values(c.uv) as { uv: number[]; uv_size: number[] }[]) {
            expect(f.uv[0] + f.uv_size[0]).toBeLessThanOrEqual(g.description.texture_width);
            expect(f.uv[1] + f.uv_size[1]).toBeLessThanOrEqual(g.description.texture_height);
          }
        }
      }
      expect(cubes).toBeGreaterThan(50);
      expect(cubes).toBeLessThanOrEqual(7000); // budget per dispositivi Android
      const tex = zip.file(Object.keys(zip.files).find((f) => /textures\/entity\/.+\.png$/.test(f))!)!;
      const meta = await sharp(await tex.async("nodebuffer")).metadata();
      expect(meta.width).toBe(g.description.texture_width);
      expect(meta.height).toBe(g.description.texture_height);
      if (kind === "car") expect([...names]).toEqual(expect.arrayContaining(["body", "glass", "wheel_1_l", "wheel_2_r", "interior"]));
      else expect([...names]).toEqual(expect.arrayContaining(["body", "turret", "barrel", "track_l", "track_r"]));
    });
  }
});

describe("Test 8: esportazione e validazione MCADDON", () => {
  it("struttura completa e coerente, validata dal verificatore", async () => {
    const { r, buf, zip } = await build("car");
    const v = await verifyMcaddon(buf);
    console.log("controlli MCADDON:", v.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" | "));
    expect(v.ok).toBe(true);
    const files = Object.keys(zip.files);
    const rp = files.find((f) => f.endsWith("_RP/manifest.json"))!.split("/")[0], bp = files.find((f) => f.endsWith("_BP/manifest.json"))!.split("/")[0];
    for (const f of ["manifest.json", "pack_icon.png", "texts/languages.json", "texts/it_IT.lang", "texts/en_US.lang"]) {
      expect(zip.file(`${rp}/${f}`), `${rp}/${f}`).toBeTruthy();
      expect(zip.file(`${bp}/${f}`), `${bp}/${f}`).toBeTruthy();
    }
    const client = (await json(zip, /_RP\/entity\/.+\.json$/))["minecraft:client_entity"].description;
    const rc = (await json(zip, /render_controllers\/.+\.json$/)).render_controllers;
    const ctrl = rc[client.render_controllers[0]];
    // ogni materiale usato dal render controller è definito nella client entity
    for (const m of ctrl.materials) for (const ref of Object.values(m) as string[]) expect(Object.keys(client.materials)).toContain(ref.replace("Material.", ""));
    expect(client.spawn_egg.base_color).toMatch(/^#[0-9a-f]{6}$/);
    const anim = await json(zip, /animations\/.+\.json$/);
    const geo = (await json(zip, /\.geo\.json$/))["minecraft:geometry"][0];
    for (const a of Object.values(anim.animations) as { bones: Record<string, unknown> }[]) for (const b of Object.keys(a.bones)) expect(geo.bones.some((x: { name: string }) => x.name === b)).toBe(true);
    const ent = (await json(zip, /_BP\/entities\/.+\.json$/))["minecraft:entity"];
    expect(ent.description.identifier).toBe(client.identifier);
    expect(ent.components["minecraft:rideable"].seats).toHaveLength(ent.components["minecraft:rideable"].seat_count);
    expect(ent.components["minecraft:input_ground_controlled"]).toBeDefined();
    const lang = await zip.file(`${rp}/texts/it_IT.lang`)!.async("string");
    expect(lang).toContain(`entity.${client.identifier}.name=`);
    expect((r.report as { minecraft: { minEngine: string } }).minecraft.minEngine).toBe("1.21.0");
  });
});
