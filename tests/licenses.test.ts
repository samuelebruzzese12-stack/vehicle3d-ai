import { describe, expect, it } from "vitest";
import { checkUse, parseLicense, type Credit } from "@/lib/licenses";

describe("licenze", () => {
  it.each([
    ["CC BY-SA 4.0", "cc-by-sa", "4.0"],
    ["CC BY 2.0", "cc-by", "2.0"],
    ["Public domain", "public-domain", undefined],
    ["Pubblico dominio", "public-domain", undefined],
    ["CC0", "cc0", undefined],
    ["by-nc", "cc-by-nc", undefined],
    ["CC Attribution-NonCommercial-NoDerivs", "cc-by-nc-nd", undefined],
    ["mit", "mit", undefined],
    ["NOASSERTION", "unknown", undefined],
    ["", "unknown", undefined],
    ["st", "sketchfab-standard", undefined],
  ])("%s → %s", (raw, id, ver) => {
    const l = parseLicense(raw);
    expect(l.id).toBe(id);
    expect(l.version).toBe(ver);
  });

  const credit = (lic: string, usage: Credit["usage"] = "modello"): Credit => ({ title: "x", sourceName: "test", license: parseLicense(lic), usage });

  it("blocca ND e licenze sconosciute", () => {
    expect(checkUse([credit("CC BY-ND 4.0")], { commercial: false }).allowed).toBe(false);
    expect(checkUse([credit("")], { commercial: false }).allowed).toBe(false);
  });
  it("NC consentito solo per uso non commerciale", () => {
    expect(checkUse([credit("CC BY-NC 4.0")], { commercial: false }).allowed).toBe(true);
    expect(checkUse([credit("CC BY-NC 4.0")], { commercial: true }).allowed).toBe(false);
  });
  it("share-alike propagata e incompatibilità rilevata", () => {
    const ok = checkUse([credit("CC BY-SA 4.0")], { commercial: true });
    expect(ok.allowed).toBe(true);
    expect(ok.inheritedLicense?.id).toBe("cc-by-sa");
    expect(checkUse([credit("CC BY-SA 4.0"), credit("CC BY-NC-SA 4.0")], { commercial: false }).allowed).toBe(false);
  });
  it("le immagini consultate non bloccano", () => {
    expect(checkUse([credit("", "immagine")], { commercial: true }).allowed).toBe(true);
  });
});
