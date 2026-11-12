import "server-only";
import { parseLicense } from "../licenses";
import { getJson } from "./net";
import type { ExternalModel } from "./sketchfab";

/** Wikimedia Commons ospita modelli 3D (STL), ognuno con la propria licenza. */
export interface Commons3D extends ExternalModel { fileUrl: string }

export async function searchCommons3D(query: string, limit = 10): Promise<Commons3D[]> {
  const p = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", generator: "search", gsrnamespace: "6", gsrlimit: String(limit),
    gsrsearch: `${query} filemime:application/sla`, prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: "LicenseShortName|Artist",
  });
  const r = await getJson<{ query?: { pages?: { title: string; imageinfo?: { url: string; size: number; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }[] } }>(
    `https://commons.wikimedia.org/w/api.php?${p}`, { source: "Wikimedia Commons" });
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (r.query?.pages ?? []).flatMap((pg) => {
    const ii = pg.imageinfo?.[0];
    if (!ii) return [];
    const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").trim();
    const license = parseLicense(strip(ii.extmetadata?.LicenseShortName?.value));
    const name = pg.title.replace(/^File:/, "");
    const author = strip(ii.extmetadata?.Artist?.value).slice(0, 120);
    return [{
      source: "github" as const, // trattato come file scaricabile diretto
      id: `commons:${name}`, name, author, pageUrl: ii.descriptionurl, license, fileUrl: ii.url,
      formats: [{ type: "stl", size: ii.size }], downloadable: true,
      relevance: words.filter((w) => name.toLowerCase().includes(w)).length / Math.max(1, words.length),
      credit: { title: name, author, sourceName: "Wikimedia Commons", sourceUrl: ii.descriptionurl, license, usage: "modello" as const },
    }];
  });
}
