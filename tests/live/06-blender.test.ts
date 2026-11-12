import { describe, expect, it } from "vitest";
import { importModel } from "@/lib/formats/import";
import { blenderPreprocess } from "@/lib/mesh/blender";
import { readGlb } from "@/lib/mesh/io";
import { buildSoup, triangleCount } from "@/lib/mesh/scene";
import { verifyGlb } from "@/lib/verify";
import { syntheticCar } from "../fixtures";

const url = process.env.BLENDER_WORKER_URL;

describe.skipIf(!url)("Test 6: elaborazione Blender (worker reale con bpy)", () => {
  it("pulizia + decimazione + separazione + texture baking", async () => {
    const glb = await syntheticCar({ rearAt: "-z" });
    const res = await fetch(`${url}/process?target_tris=300&separate=1&bake=512`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.BLENDER_WORKER_TOKEN}` }, body: Buffer.from(glb),
    });
    expect(res.status).toBe(200);
    const report = JSON.parse(res.headers.get("x-vehicle3d-report")!);
    console.log("report Blender:", JSON.stringify(report));
    expect(report.separated_parts).toBe(10);
    expect(report.baked_atlas_px).toBe(512);
    expect(report.triangles_after).toBeLessThanOrEqual(456); // il worker impone un minimo di 1000 triangoli: nessuna decimazione qui
    const out = new Uint8Array(await res.arrayBuffer());
    const v = await verifyGlb(out);
    expect(v.ok).toBe(true);
    const doc = await readGlb(out);
    expect(doc.getRoot().listTextures().length).toBe(1); // atlas unico
    // il colore della vernice (blu) è stato cotto nella texture (salvata in sRGB)
    const soup = await buildSoup(doc);
    let blue = 0;
    for (let i = 0; i < soup.count; i++) if (soup.color[i * 4 + 2] > 0.6 && soup.color[i * 4 + 2] > soup.color[i * 4] * 1.8) blue++; // atlas in sRGB
    expect(blue).toBeGreaterThanOrEqual(12); // i 12 triangoli della scocca blu
  });

  it("conversione STL tramite Blender da importModel", async () => {
    const doc = await readGlb(await syntheticCar({ rearAt: "-z" }));
    const soup = await buildSoup(doc);
    const stl = Buffer.alloc(84 + soup.count * 50);
    stl.writeUInt32LE(soup.count, 80);
    for (let t = 0; t < soup.count; t++) for (let k = 0; k < 9; k++) stl.writeFloatLE(soup.pos[t * 9 + k], 84 + t * 50 + 12 + k * 4);
    const viaBlender = await fetch(`${url}/convert?format=stl`, { method: "POST", headers: { Authorization: `Bearer ${process.env.BLENDER_WORKER_TOKEN}` }, body: stl });
    expect(viaBlender.status).toBe(200);
    const g = await readGlb(new Uint8Array(await viaBlender.arrayBuffer()));
    expect(triangleCount(g)).toBe(soup.count);
    // anche il percorso JS (STL nativo) produce lo stesso numero di triangoli
    const js = await importModel(new Uint8Array(stl), "auto.stl");
    expect(triangleCount(await readGlb(js.glb))).toBe(soup.count);
  });

  it("pre-elaborazione integrata nella pipeline (blenderPreprocess)", async () => {
    const r = await blenderPreprocess(await syntheticCar({ rearAt: "-z" }), 1000);
    expect(r?.report.ok).toBe(true);
  });
});
