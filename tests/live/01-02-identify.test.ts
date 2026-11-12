import { describe, expect, it } from "vitest";
import { identifyByName, toVehicleInput } from "@/lib/sources/wikidata";

describe("Test 1-2: ricerca per nome (Wikidata + Wikipedia, gratuito)", () => {
  it("1. T-90 → carro armato russo con dimensioni reali", async () => {
    const r = await identifyByName("T-90");
    const b = r[0];
    console.log("T-90:", JSON.stringify({ qid: b.qid, label: b.label, cat: b.category, manu: b.manufacturer, anni: [b.yearFrom, b.yearTo], dim: b.dimensions_m, massKg: b.massKg, crew: b.crew, commons: b.commonsCategory, varianti: b.variants.map((v) => v.label), wiki: b.wikipedia.map((w) => w.url) }, null, 1));
    expect(b.qid).toBe("Q192757");
    expect(b.category).toBe("carro_armato");
    expect(b.dimensions_m?.length).toBeGreaterThan(6);
    expect(b.commonsCategory).toBeTruthy();
    expect(b.wikipedia.some((w) => w.extract && w.extract.length > 50)).toBe(true);
    expect(toVehicleInput(b).category).toBe("carro_armato");
  });

  it("2. Alfa Romeo 159 → automobile, marca e modello separati, dimensioni in metri", async () => {
    const r = await identifyByName("Alfa Romeo 159");
    const b = r[0];
    console.log("Alfa 159:", JSON.stringify({ qid: b.qid, make: b.make, model: b.model, anniFonte: b.yearsSource, cat: b.category, manu: b.manufacturer, anni: [b.yearFrom, b.yearTo], dim: b.dimensions_m, commons: b.commonsCategory, varianti: b.variants.map((v) => v.label) }, null, 1));
    expect(b.qid).toBe("Q1610");
    expect(b.category).toBe("auto");
    expect(b.make).toBe("Alfa Romeo");
    expect(b.model).toBe("159");
    expect(b.dimensions_m?.length).toBeCloseTo(4.661, 2);
    expect(b.commonsCategory).toBe("Alfa Romeo 159");
    expect(b.yearFrom).toBe(2005);
  });
});
