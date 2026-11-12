import { describe, expect, it } from "vitest";
import { readGlb } from "@/lib/mesh/io";
import { buildSoup, normalize } from "@/lib/mesh/scene";
import { segment } from "@/lib/mesh/segment";
import { syntheticTank } from "./fixtures";

async function seg(barrelAt: "+z" | "-z") {
  const doc = await readGlb(await syntheticTank({ barrelAt }));
  await normalize(doc, {});
  return segment(await buildSoup(doc), { category: "carro_armato" });
}

describe("segmentazione cingolati", () => {
  it("riconosce cingoli, torretta e cannone", async () => {
    const s = await seg("+z");
    expect(s.stats.barrel).toBeGreaterThan(0);
    expect(s.stats.turret).toBeGreaterThan(0);
    expect(s.stats.track_l).toBeGreaterThan(0);
    expect(s.stats.track_r).toBeGreaterThan(0);
    expect(s.tracked!.barrelLength).toBeGreaterThan(2);
    expect(s.flipSuggested).toBe(false);
    expect(s.wheels).toHaveLength(0);
  });
  it("suggerisce la rotazione se il cannone punta all'indietro", async () => {
    expect((await seg("-z")).flipSuggested).toBe(true);
  });
});
