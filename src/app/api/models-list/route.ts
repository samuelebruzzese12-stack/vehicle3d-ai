import { z } from "zod";
import { clientIp, handler, rateLimit, readJson } from "@/lib/http";
import { vehicleModels } from "@/lib/sources/wikidata";
import { CATEGORIES } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ make: z.string().max(60).optional(), category: z.enum(CATEGORIES) });

/** Elenco di modelli per il riconoscimento da foto (CLIP nel browser). */
export const POST = handler(async (req) => {
  rateLimit(`models:${clientIp(req)}`, 10, 60_000);
  const b = await readJson(req, (x) => Body.parse(x));
  return { models: await vehicleModels(b, 120) };
});
