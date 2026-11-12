import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fetchLimited } from "@/lib/http";
import { commonsCategoryImages } from "@/lib/sources/commons";
import { findTexture, TEXTURE_SLOTS } from "@/lib/sources/polyhaven";

describe("Test 3: fotografie e texture (Commons + Poly Haven, gratuiti)", () => {
  for (const cat of ["T-90 tanks", "Alfa Romeo 159"]) {
    it(`foto dalla categoria Commons "${cat}" con licenza, autore e vista`, async () => {
      const imgs = await commonsCategoryImages(cat, 40);
      const views: Record<string, number> = {};
      const lic: Record<string, number> = {};
      for (const i of imgs) { views[i.queryView] = (views[i.queryView] ?? 0) + 1; lic[i.license ?? "?"] = (lic[i.license ?? "?"] ?? 0) + 1; }
      console.log(cat, imgs.length, "immagini", JSON.stringify(views), JSON.stringify(lic));
      expect(imgs.length).toBeGreaterThan(10);
      expect(imgs.every((i) => i.pageUrl?.startsWith("https://commons.wikimedia.org/"))).toBe(true);
      expect(imgs.filter((i) => i.licenseId && i.licenseId !== "unknown").length).toBeGreaterThan(imgs.length * 0.8);
      // download reale e decodifica della prima immagine
      const { buffer } = await fetchLimited(imgs[0].imageUrl, { maxBytes: 15e6, timeoutMs: 30000 });
      const meta = await sharp(buffer).metadata();
      expect(meta.width).toBeGreaterThan(300);
    });
  }

  it("texture PBR CC0 per ogni slot materiale", async () => {
    for (const slot of Object.keys(TEXTURE_SLOTS) as (keyof typeof TEXTURE_SLOTS)[]) {
      const t = await findTexture(slot);
      console.log(slot, "→", t?.id, t?.credit.author, t?.credit.license.label, Object.keys(t?.maps ?? {}).filter((k) => (t!.maps as Record<string, string | undefined>)[k]).join(","));
      expect(t, slot).not.toBeNull();
      expect(t!.credit.license.id).toBe("cc0");
      expect(t!.maps.diffuse).toMatch(/^https:\/\/dl\.polyhaven\.org\//);
    }
    const t = await findTexture("tessuto");
    const { buffer } = await fetchLimited(t!.maps.diffuse!, { maxBytes: 20e6, timeoutMs: 30000 });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(1024);
  });
});
