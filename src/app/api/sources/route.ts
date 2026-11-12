import { z } from "zod";
import { searchExternalModels, searchMinecraftAddons } from "@/lib/engines/acquire";
import { clientIp, handler, rateLimit, readJson } from "@/lib/http";
import { commonsCategoryImages, commonsSearch } from "@/lib/sources/commons";
import { findTexture, TEXTURE_SLOTS } from "@/lib/sources/polyhaven";
import { VehicleInputSchema } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  name: z.string().trim().min(2).max(100),
  vehicle: VehicleInputSchema,
  commonsCategory: z.string().max(200).optional(),
  commercial: z.boolean().default(false),
});

/** Raccolta multifonte: foto (Commons), texture (Poly Haven), modelli 3D (C), addon Minecraft (D). Ogni fonte riporta il proprio esito. */
export const POST = handler(async (req) => {
  rateLimit(`sources:${clientIp(req)}`, 6, 60_000);
  const b = await readJson(req, (x) => Body.parse(x));
  const summary: { source: string; ok: boolean; count: number; message?: string }[] = [];
  const settle = async <T>(source: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      const r = await fn();
      summary.push({ source, ok: true, count: r.length });
      return r;
    } catch (e) {
      summary.push({ source, ok: false, count: 0, message: (e as Error).message });
      return [];
    }
  };
  const photos = await settle("Wikimedia Commons (foto)", async () => {
    if (b.commonsCategory) {
      const r = await commonsCategoryImages(b.commonsCategory, 48);
      if (r.length >= 6) return r;
    }
    return commonsSearch(b.name, "front_three_quarter", 24);
  });
  const textures = await settle("Poly Haven (texture CC0)", async () => {
    const out = [];
    for (const slot of Object.keys(TEXTURE_SLOTS) as (keyof typeof TEXTURE_SLOTS)[]) {
      const t = await findTexture(slot);
      if (t) out.push({ slot, ...t });
    }
    return out;
  });
  const c = await searchExternalModels(b.name, b.commercial);
  summary.push(...c.summary.map((s) => ({ ...s, source: `Modelli 3D – ${s.source}` })));
  const d = await searchMinecraftAddons(b.name, b.commercial);
  summary.push(...d.summary.map((s) => ({ ...s, source: `Addon – ${s.source}` })));
  const q = encodeURIComponent(b.name);
  return {
    photos,
    textures,
    models: c.candidates.slice(0, 20),
    addons: d.candidates.slice(0, 20),
    summary,
    manualLinks: [
      { label: "Sketchfab (ricerca manuale)", url: `https://sketchfab.com/search?q=${q}&type=models&features=downloadable` },
      { label: "CGTrader – modelli gratuiti (verifica la licenza)", url: `https://www.cgtrader.com/free-3d-models?keywords=${q}` },
      { label: "MCPEDL – addon (verifica i permessi dell'autore)", url: `https://mcpedl.com/?s=${q}` },
      { label: "Hugging Face – dataset 3D", url: `https://huggingface.co/datasets?search=${q}%203d` },
    ],
  };
});
