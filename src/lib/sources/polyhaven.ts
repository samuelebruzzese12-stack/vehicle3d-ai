import "server-only";
import { parseLicense, type Credit } from "../licenses";
import { getJson } from "./net";

/** Poly Haven: texture PBR gratuite, tutte CC0. API pubblica senza chiave (https://api.polyhaven.com). */
const API = "https://api.polyhaven.com";

interface Asset { name: string; categories: string[]; tags: string[]; authors: Record<string, string> }
export interface PbrTexture {
  id: string;
  name: string;
  maps: { diffuse?: string; normal?: string; roughness?: string; metal?: string };
  pageUrl: string;
  credit: Credit;
}

/** Slot materiale → criteri di ricerca nel catalogo Poly Haven. */
/**
 * Asset scelti a mano (verificati nel catalogo) con ricerca per tag come riserva.
 * Il catalogo Poly Haven non contiene texture di pneumatici: per la gomma si usa un materiale procedurale.
 */
export const TEXTURE_SLOTS: Record<string, { curated: string[]; categories?: string[]; tags: string[]; avoid?: string[] }> = {
  metallo: { curated: ["metal_plate"], categories: ["metal"], tags: ["metal sheet", "bare"], avoid: ["rust", "rusty", "grate"] },
  metallo_usurato: { curated: ["rusty_metal_02", "rusty_painted_metal"], categories: ["metal"], tags: ["rust", "weathered"] },
  tessuto: { curated: ["poly_wool_herringbone", "denim_fabric_05"], categories: ["fabric"], tags: ["grey", "woven"], avoid: ["floral", "white", "yellow"] },
  pelle: { curated: ["brown_leather"], categories: ["leather"], tags: ["leather"] },
  cingolo: { curated: ["rusty_metal_grid", "metal_plate"], categories: ["metal"], tags: ["metal", "worn"] },
};

let catalog: Promise<Record<string, Asset>> | null = null;
function textures() {
  if (!catalog) catalog = getJson<Record<string, Asset>>(`${API}/assets?t=textures`, { source: "Poly Haven" }).catch((e) => { catalog = null; throw e; });
  return catalog;
}

export async function findTexture(slot: keyof typeof TEXTURE_SLOTS, res: "1k" | "2k" = "1k"): Promise<PbrTexture | null> {
  const rule = TEXTURE_SLOTS[slot];
  const all = await textures();
  let best: [string, Asset, number] | null = null;
  const cur = rule.curated.find((c) => all[c]);
  if (cur) best = [cur, all[cur], 99];
  for (const [id, a] of best ? [] : Object.entries(all)) {
    const tags = [...a.tags, ...a.categories, id].map((t) => t.toLowerCase().trim());
    if (rule.categories && !rule.categories.some((c) => a.categories.includes(c))) continue;
    if (rule.avoid?.some((x) => tags.some((t) => t.includes(x)))) continue;
    const score = rule.tags.reduce((s, t) => s + (tags.some((x) => x.includes(t)) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best[2] || (score === best[2] && id < best[0]))) best = [id, a, score];
  }
  if (!best) return null;
  const [id, a] = best;
  const files = await getJson<Record<string, Record<string, Record<string, { url: string }>>>>(`${API}/files/${id}`, { source: "Poly Haven" });
  const pick = (k: string) => files[k]?.[res]?.jpg?.url ?? files[k]?.[res]?.png?.url;
  return {
    id,
    name: a.name,
    maps: { diffuse: pick("Diffuse"), normal: pick("nor_gl"), roughness: pick("Rough"), metal: pick("Metal") },
    pageUrl: `https://polyhaven.com/a/${id}`,
    credit: { title: `Texture "${a.name}"`, author: Object.keys(a.authors).join(", "), sourceName: "Poly Haven", sourceUrl: `https://polyhaven.com/a/${id}`, license: parseLicense("CC0"), usage: "texture" },
  };
}
